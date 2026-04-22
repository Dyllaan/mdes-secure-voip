import { randomUUID, createVerify } from 'crypto';
import { spawn } from 'child_process';
import { type Request, type Response, type Router } from 'express';
import express from 'express';
import { getToken, getTurnCredentials } from '../Auth';
import { BotInstance } from '../instances/BotInstance';
import { AVBotInstance } from '../instances/AVBotInstance';
import { HubHandler } from '../HubHandler';
import { MusicSession } from '../music/MusicSession';
import type { QueueItem } from '../music/types';
import { config } from '../config';
import {
    appendStderrLines,
    createLogger,
    formatErrorForLog,
    type Logger,
    summarizeStderrLines,
    truncateForLog,
} from '../logging';

const routesLog = createLogger('http.routes');

const ALLOWED_AUDIO_ORIGINS = (config.ALLOWED_AUDIO_ORIGINS ?? 'soundcloud.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

const ALLOWED_VIDEO_ORIGINS = (config.ALLOWED_VIDEO_ORIGINS ?? '')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

function getUrlValidationFailure(url: string): 'malformed_url' | 'disallowed_domain' | null {
    try {
        const { hostname } = new URL(url);
        const h = hostname.toLowerCase();
        const allowed = ALLOWED_AUDIO_ORIGINS.some((d) => h === d || h.endsWith(`.${d}`))
            || ALLOWED_VIDEO_ORIGINS.some((d) => h === d || h.endsWith(`.${d}`));
        return allowed ? null : 'disallowed_domain';
    } catch {
        return 'malformed_url';
    }
}

function isAllowedUrl(url: string): boolean {
    return getUrlValidationFailure(url) === null;
}

function resolveVideoMode(url: string, requested: boolean): boolean {
    if (!requested) return false;
    try {
        const h = new URL(url).hostname.toLowerCase();
        return ALLOWED_VIDEO_ORIGINS.some((d) => h === d || h.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

const USER_PLAY_LIMIT = 5;
const USER_PLAY_WINDOW_MS = 60_000;
const userPlayLimits = new Map<string, { count: number; resetAt: number }>();

const _jwtPublicKey = Buffer.from(config.JWT_PUBLIC_KEY_B64, 'base64').toString('utf8');

interface RouteLocals {
    requestId?: string;
    requestLogger?: Logger;
    requestMeta?: Record<string, unknown>;
}

interface AuthValidationResult {
    userId: string | null;
    reason?: string;
    tokenLength?: number;
}

interface ResolvedItem {
    id: string;
    url: string;
    title: string;
    channel: string;
    duration: string;
    durationMs: number;
}

const MAX_URL_LENGTH = 2048;
const MAX_ID_LENGTH = 128;

function getRouteLocals(res: Response): RouteLocals {
    return res.locals as RouteLocals;
}

function getRequestLogger(res: Response): Logger {
    return getRouteLocals(res).requestLogger ?? routesLog.child('request');
}

function setRequestMeta(res: Response, meta: Record<string, unknown>): void {
    const locals = getRouteLocals(res);
    locals.requestMeta = {
        ...(locals.requestMeta ?? {}),
        ...meta,
    };
}

function hasAudience(payload: Record<string, unknown>, audience: string): boolean {
    const aud = payload.aud;
    if (typeof aud === 'string') return aud === audience;
    if (Array.isArray(aud)) return aud.includes(audience);
    return false;
}

function validateAccessToken(authHeader: string | undefined): AuthValidationResult {
    if (!authHeader?.startsWith('Bearer ')) return { userId: null, reason: 'missing_bearer' };

    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return { userId: null, reason: 'malformed_token', tokenLength: token.length };

    try {
        const signingInput = `${parts[0]}.${parts[1]}`;
        const signature = Buffer.from(parts[2], 'base64url');
        const verified = createVerify('RSA-SHA256').update(signingInput).end().verify(_jwtPublicKey, signature);
        if (!verified) return { userId: null, reason: 'invalid_signature', tokenLength: token.length };

        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
        if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) {
            return { userId: null, reason: 'expired', tokenLength: token.length };
        }
        if (payload.iss !== config.JWT_ISSUER) return { userId: null, reason: 'invalid_issuer', tokenLength: token.length };
        if (payload.token_use !== 'access') return { userId: null, reason: 'invalid_token_use', tokenLength: token.length };
        if (!hasAudience(payload, config.JWT_ACCESS_AUDIENCE)) {
            return { userId: null, reason: 'invalid_audience', tokenLength: token.length };
        }
        if (typeof payload.sub !== 'string' || !payload.sub) {
            return { userId: null, reason: 'missing_subject', tokenLength: token.length };
        }

        return { userId: payload.sub, tokenLength: token.length };
    } catch {
        return { userId: null, reason: 'invalid_payload', tokenLength: token.length };
    }
}

function extractUserId(authHeader: string | undefined): string {
    return validateAccessToken(authHeader).userId ?? 'anonymous';
}

async function checkRoomAccess(roomId: string, authHeader: string | undefined, logger: Logger): Promise<boolean> {
    if (!authHeader?.startsWith('Bearer ')) {
        logger.warn('room_access.rejected', { roomId, reason: 'missing_bearer' });
        return false;
    }

    try {
        const res = await fetch(`${config.HUB_SERVICE_URL}/channels/${roomId}/access`, {
            headers: { Authorization: authHeader },
        });
        logger.info('room_access.checked', { roomId, status: res.status, allowed: res.ok });
        return res.ok;
    } catch (error) {
        logger.error('room_access.error', {
            roomId,
            error: formatErrorForLog(error),
        });
        return false;
    }
}

async function ensureRoomAccess(
    req: Request,
    res: Response,
    route: string,
    roomId: string,
): Promise<boolean> {
    const logger = getRequestLogger(res);
    if (!await checkRoomAccess(roomId, req.headers.authorization, logger.child('roomAccess', { route, roomId }))) {
        setRequestMeta(res, { roomId, rejectReason: 'room_access_denied' });
        logger.warn('request.rejected', {
            route,
            roomId,
            statusCode: 403,
            rejectionReason: 'room_access_denied',
        });
        res.status(403).json({ error: 'Not a member of this room' });
        return false;
    }
    return true;
}

function evaluateUserRateLimit(userId: string): { allowed: boolean; count: number; resetAt: number } {
    const now = Date.now();
    const entry = userPlayLimits.get(userId) ?? { count: 0, resetAt: now + USER_PLAY_WINDOW_MS };
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + USER_PLAY_WINDOW_MS;
    }
    entry.count++;
    userPlayLimits.set(userId, entry);
    return {
        allowed: entry.count <= USER_PLAY_LIMIT,
        count: entry.count,
        resetAt: entry.resetAt,
    };
}

function checkUserRateLimit(userId: string): boolean {
    return evaluateUserRateLimit(userId).allowed;
}

function secondsToTimestamp(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function resolveUrl(url: string, logger: Logger): Promise<ResolvedItem[]> {
    return new Promise((resolve, reject) => {
        const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

        const isSoundCloud = /soundcloud\.com/i.test(url);
        const isSCSingle = isSoundCloud && !/\/sets\//.test(url) && (() => {
            try { return new URL(url).pathname.split('/').filter(Boolean).length === 2; } catch { return false; }
        })();
        const useFlatPlaylist = !isSCSingle;

        const maxMb = process.env.YTDLP_MAX_FILESIZE_MB ?? '50';
        const args = [
            ...(useFlatPlaylist ? ['--flat-playlist'] : []),
            '-J',
            '--no-warnings',
            '--max-filesize', `${maxMb}M`,
            '--js-runtimes', 'quickjs:/usr/bin/qjs',
            '--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl}`,
        ];

        if (process.env.YTDLP_COOKIES_PATH) {
            args.push('--cookies', process.env.YTDLP_COOKIES_PATH);
        }

        args.push(url);

        const resolveLog = logger.child('resolveSubprocess', {
            url: truncateForLog(url, 220),
            command: 'yt-dlp',
            args,
            isSoundCloud,
            useFlatPlaylist,
        });
        resolveLog.info('resolve.spawn.start');

        const ytdlp = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        const stderrLines: string[] = [];

        ytdlp.stdout?.on('data', (d: Buffer) => {
            stdout += d.toString();
        });
        ytdlp.stderr?.on('data', (d: Buffer) => {
            appendStderrLines(stderrLines, d, 10);
            resolveLog.debug('resolve.stderr', { chunk: truncateForLog(d.toString(), 300) });
        });

        const timeoutMs = isSCSingle ? 60_000 : 30_000;
        const timeout = setTimeout(() => {
            ytdlp.kill('SIGTERM');
            resolveLog.warn('resolve.timeout', { timeoutMs });
            reject(new Error('yt-dlp resolve timed out'));
        }, timeoutMs);

        ytdlp.on('error', (error) => {
            clearTimeout(timeout);
            resolveLog.error('resolve.spawn.error', { error: formatErrorForLog(error) });
            reject(error);
        });

        ytdlp.on('close', (code, signal) => {
            clearTimeout(timeout);
            const stderrSummary = summarizeStderrLines(stderrLines);
            resolveLog.info('resolve.spawn.close', { code, signal, stderrSummary });

            if (code !== 0) {
                reject(new Error(stderrSummary || `yt-dlp exited with code ${code}`));
                return;
            }

            try {
                const data = JSON.parse(stdout);
                const entries: Record<string, unknown>[] = data.entries ?? [data];
                const items: ResolvedItem[] = entries
                    .filter((entry) => entry && entry.id)
                    .map((entry) => ({
                        id: String(entry.id),
                        url: String(entry.webpage_url ?? entry.url ?? `https://www.youtube.com/watch?v=${entry.id}`),
                        title: String(entry.title ?? entry.id),
                        channel: String(entry.channel ?? entry.uploader ?? 'Unknown'),
                        duration: typeof entry.duration === 'number' ? secondsToTimestamp(entry.duration) : '-',
                        durationMs: typeof entry.duration === 'number' ? Math.round(entry.duration * 1000) : 0,
                    }));
                resolveLog.info('resolve.parse.success', { itemCount: items.length });
                resolve(items);
            } catch (error) {
                resolveLog.error('resolve.parse.failed', {
                    error: formatErrorForLog(error),
                    stdoutPreview: truncateForLog(stdout, 400),
                });
                reject(new Error('Failed to parse yt-dlp output'));
            }
        });
    });
}

function makeBotInstance(roomId: string, url: string, videoMode: boolean): BotInstance {
    const token = getToken();
    const creds = getTurnCredentials();
    return videoMode
        ? new AVBotInstance(roomId, url, token, creds)
        : new BotInstance(roomId, url, token, creds);
}

function isValidId(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

function isValidUrl(url: unknown): url is string {
    return typeof url === 'string' && url.length > 0 && url.length <= MAX_URL_LENGTH;
}

function rejectRequest(
    res: Response,
    statusCode: number,
    error: string,
    rejectionReason: string,
    details: Record<string, unknown> = {},
): void {
    setRequestMeta(res, { rejectReason: rejectionReason, ...details });
    getRequestLogger(res).warn('request.rejected', {
        statusCode,
        rejectionReason,
        ...details,
    });
    res.status(statusCode).json({ error });
}

function authorizeRequest(req: Request, res: Response, route: string): string | null {
    const logger = getRequestLogger(res);
    const authResult = validateAccessToken(req.headers.authorization);
    setRequestMeta(res, {
        route,
        userId: authResult.userId ?? 'anonymous',
    });

    if (!authResult.userId) {
        logger.warn('authorization.rejected', {
            route,
            reason: authResult.reason,
            tokenLength: authResult.tokenLength,
        });
        rejectRequest(res, 401, 'Unauthorized', authResult.reason ?? 'unauthorized', { route });
        return null;
    }

    logger.debug('authorization.accepted', {
        route,
        userId: authResult.userId,
        tokenLength: authResult.tokenLength,
    });
    return authResult.userId;
}

function setRouteContext(
    res: Response,
    route: string,
    details: {
        roomId?: string;
        hubId?: string;
        url?: string;
        requestedVideoMode?: unknown;
        resolvedVideoMode?: boolean;
    } = {},
): void {
    setRequestMeta(res, {
        route,
        roomId: details.roomId,
        hubId: details.hubId,
        url: typeof details.url === 'string' ? truncateForLog(details.url, 220) : undefined,
        requestedVideoMode: details.requestedVideoMode === true,
        resolvedVideoMode: details.resolvedVideoMode,
    });
}

function isValidQueueItemPayload(item: unknown): item is QueueItem {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    return isValidId(candidate.id)
        && isValidUrl(candidate.url)
        && typeof candidate.title === 'string'
        && candidate.title.length > 0
        && typeof candidate.channel === 'string'
        && candidate.channel.length > 0
        && typeof candidate.duration === 'string'
        && typeof candidate.durationMs === 'number'
        && isFinite(candidate.durationMs)
        && candidate.durationMs >= 0
        && (candidate.source === undefined
            || candidate.source === 'soundcloud');
}

function normalizeQueueItems(items: unknown[]): QueueItem[] {
    return items.map((item) => {
        if (!isValidQueueItemPayload(item)) throw new Error('Invalid queue item payload');
        const urlFailure = getUrlValidationFailure(item.url);
        if (urlFailure) throw new Error('Queue item URL domain not permitted');
        return {
            id: item.id,
            url: item.url,
            title: item.title,
            channel: item.channel,
            duration: item.duration,
            durationMs: Math.round(item.durationMs),
            source: item.source,
        };
    });
}

function makeFallbackQueueItem(url: string): QueueItem {
    let title = 'Loading...';
    let channel = 'Unknown';
    let source: QueueItem['source'];

    try {
        const parsed = new URL(url);
        if (parsed.hostname.includes('soundcloud.com')) {
            const parts = parsed.pathname.split('/').filter(Boolean);
            title = parts.at(-1)?.replace(/-/g, ' ') || title;
            channel = parts[0] ?? 'SoundCloud';
            source = 'soundcloud';
        } else if (parsed.hostname.includes('youtube.com') || parsed.hostname === 'youtu.be') {
            source = 'youtube';
            channel = 'YouTube';
            const videoId = parsed.hostname === 'youtu.be'
                ? parsed.pathname.slice(1).split('?')[0]
                : parsed.searchParams.get('v');
            if (videoId) title = `Video ${videoId.slice(-6)}`;
        }
    } catch {
        // Keep fallback values.
    }

    return {
        id: randomUUID(),
        url,
        title,
        channel,
        duration: '-',
        durationMs: 0,
        source,
    };
}

function respondWithSession(res: Response, roomId: string, session: MusicSession, extras: Record<string, unknown> = {}): void {
    res.json({
        ok: true,
        roomId,
        session: session.getState(),
        ...extras,
    });
}

export function createRouter(sessions: Map<string, MusicSession>): Router {
    const router = express.Router();

    const createSession = (roomId: string, items: QueueItem[], videoMode: boolean): MusicSession => {
        const bot = makeBotInstance(roomId, items[0].url, videoMode);
        const session = new MusicSession(roomId, bot, items, (disposedRoomId) => {
            sessions.delete(disposedRoomId);
        });
        sessions.set(roomId, session);
        return session;
    };

    router.use((req, res, next) => {
        const incomingRequestId = req.header('x-request-id')?.trim();
        const requestId = incomingRequestId || randomUUID();
        const startedAt = Date.now();
        const requestLogger = routesLog.child('request', {
            requestId,
            method: req.method,
            path: req.path,
        });

        const locals = getRouteLocals(res);
        locals.requestId = requestId;
        locals.requestLogger = requestLogger;
        locals.requestMeta = {};

        res.setHeader('x-request-id', requestId);
        requestLogger.info('request.start');

        res.on('finish', () => {
            requestLogger.info('request.complete', {
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
                ...(locals.requestMeta ?? {}),
            });
        });

        next();
    });

    router.get('/health', (_req: Request, res: Response) => {
        const route = '/health';
        setRouteContext(res, route);
        getRequestLogger(res).info('health.success', {
            route,
            roomCount: sessions.size,
        });
        res.json({
            status: 'ok',
            roomCount: sessions.size,
            activeRoomIds: [...sessions.keys()],
        });
    });

    router.post('/hub/join', async (req: Request, res: Response) => {
        const route = '/hub/join';
        const { hubId } = req.body as { hubId?: string };
        setRouteContext(res, route, { hubId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        const rateLimit = evaluateUserRateLimit(userId);
        if (!rateLimit.allowed) {
            rejectRequest(res, 429, 'Too many requests, please slow down', 'rate_limited', {
                route,
                hubId,
                userId,
                requestCount: rateLimit.count,
                resetAt: new Date(rateLimit.resetAt).toISOString(),
            });
            return;
        }

        if (!isValidId(hubId)) {
            rejectRequest(res, 400, 'hubId is required', 'missing_hub_id', { route, userId });
            return;
        }

        let token: string;
        try {
            token = getToken();
        } catch (error) {
            getRequestLogger(res).error('hub.join.token_unavailable', { error: formatErrorForLog(error), hubId, userId });
            rejectRequest(res, 503, 'Bot is not authenticated yet - retry in a moment', 'bot_token_unavailable', { route, hubId, userId });
            return;
        }

        try {
            getRequestLogger(res).info('hub.join.start', { hubId, userId });
            await HubHandler.joinHub(hubId, token);
            getRequestLogger(res).info('hub.join.success', { hubId, userId });
            res.json({ ok: true });
        } catch (error) {
            getRequestLogger(res).warn('hub.join.failed', {
                hubId,
                userId,
                error: formatErrorForLog(error),
            });
            const msg = error instanceof Error ? error.message : String(error);
            res.status(403).json({ error: msg });
        }
    });

    router.post('/join', async (req: Request, res: Response) => {
        const route = '/join';
        const { roomId, url, videoMode } = req.body as { roomId?: string; url?: string; videoMode?: unknown };
        setRouteContext(res, route, { roomId, url, requestedVideoMode: videoMode });

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route });
            return;
        }
        if (!isValidUrl(url)) {
            rejectRequest(res, 400, 'url is required', 'missing_url', { route, roomId });
            return;
        }
        const joinUrlFailure = getUrlValidationFailure(url);
        if (joinUrlFailure) {
            rejectRequest(res, 400, 'URL domain not permitted', joinUrlFailure, { route, roomId, url });
            return;
        }

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        const rateLimit = evaluateUserRateLimit(userId);
        if (!rateLimit.allowed) {
            rejectRequest(res, 429, 'Too many requests, please slow down', 'rate_limited', {
                route,
                roomId,
                userId,
                requestCount: rateLimit.count,
                resetAt: new Date(rateLimit.resetAt).toISOString(),
            });
            return;
        }

        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        if (sessions.has(roomId)) {
            rejectRequest(res, 409, `Bot is already in room "${roomId}"`, 'bot_already_in_room', {
                route,
                roomId,
                userId,
            });
            return;
        }

        const resolvedVideoMode = resolveVideoMode(url, videoMode === true);
        setRouteContext(res, route, {
            roomId,
            url,
            requestedVideoMode: videoMode,
            resolvedVideoMode,
        });

        const session = createSession(roomId, [makeFallbackQueueItem(url)], resolvedVideoMode);

        try {
            getRequestLogger(res).info('bot.start.begin', { route, roomId, userId, resolvedVideoMode });
            await session.start();
            getRequestLogger(res).info('bot.start.success', { route, roomId, userId, resolvedVideoMode });
            respondWithSession(res, roomId, session, { videoMode: resolvedVideoMode });
        } catch (error) {
            getRequestLogger(res).error('bot.start.failed', {
                route,
                roomId,
                userId,
                resolvedVideoMode,
                error: formatErrorForLog(error),
            });
            session.destroy('bot_start_failed');
            const msg = error instanceof Error ? error.message : String(error);
            res.status(500).json({ error: msg });
        }
    });

    router.post('/play', async (req: Request, res: Response) => {
        const route = '/play';
        const { roomId, url, videoMode } = req.body as { roomId?: string; url?: string; videoMode?: unknown };
        setRouteContext(res, route, { roomId, url, requestedVideoMode: videoMode });

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route });
            return;
        }
        if (!isValidUrl(url)) {
            rejectRequest(res, 400, 'url is required', 'missing_url', { route, roomId });
            return;
        }
        const playUrlFailure = getUrlValidationFailure(url);
        if (playUrlFailure) {
            rejectRequest(res, 400, 'URL domain not permitted', playUrlFailure, { route, roomId, url });
            return;
        }

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        const rateLimit = evaluateUserRateLimit(userId);
        if (!rateLimit.allowed) {
            rejectRequest(res, 429, 'Too many requests, please slow down', 'rate_limited', {
                route,
                roomId,
                userId,
                requestCount: rateLimit.count,
                resetAt: new Date(rateLimit.resetAt).toISOString(),
            });
            return;
        }

        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const resolvedVideoMode = resolveVideoMode(url, videoMode === true);
        setRouteContext(res, route, {
            roomId,
            url,
            requestedVideoMode: videoMode,
            resolvedVideoMode,
        });

        const existing = sessions.get(roomId);
        if (existing) {
            if (existing.videoMode !== resolvedVideoMode) {
                getRequestLogger(res).info('bot.video_mode_switch', {
                    route,
                    roomId,
                    previousVideoMode: existing.videoMode,
                    nextVideoMode: resolvedVideoMode,
                });
                existing.destroy('video_mode_switch');
            } else {
                existing.playNow(makeFallbackQueueItem(url));
                getRequestLogger(res).info('bot.change_track', { route, roomId, userId, resolvedVideoMode });
                respondWithSession(res, roomId, existing, { action: 'changeTrack', videoMode: resolvedVideoMode });
                return;
            }
        }

        const session = createSession(roomId, [makeFallbackQueueItem(url)], resolvedVideoMode);

        try {
            getRequestLogger(res).info('bot.start.begin', { route, roomId, userId, resolvedVideoMode });
            await session.start();
            getRequestLogger(res).info('bot.start.success', { route, roomId, userId, resolvedVideoMode });
            respondWithSession(res, roomId, session, { action: 'join', videoMode: resolvedVideoMode });
        } catch (error) {
            getRequestLogger(res).error('bot.start.failed', {
                route,
                roomId,
                userId,
                resolvedVideoMode,
                error: formatErrorForLog(error),
            });
            session.destroy('bot_start_failed');
            const msg = error instanceof Error ? error.message : String(error);
            res.status(500).json({ error: msg });
        }
    });

    router.post('/queue/add', async (req: Request, res: Response) => {
        const route = '/queue/add';
        const { roomId, items, videoMode } = req.body as { roomId?: string; items?: unknown[]; videoMode?: unknown };
        setRouteContext(res, route, { roomId, requestedVideoMode: videoMode });

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route });
            return;
        }
        if (!Array.isArray(items) || items.length === 0) {
            rejectRequest(res, 400, 'items must be a non-empty array', 'invalid_items', { route, roomId });
            return;
        }

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        const rateLimit = evaluateUserRateLimit(userId);
        if (!rateLimit.allowed) {
            rejectRequest(res, 429, 'Too many requests, please slow down', 'rate_limited', {
                route,
                roomId,
                userId,
                requestCount: rateLimit.count,
                resetAt: new Date(rateLimit.resetAt).toISOString(),
            });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        let normalizedItems: QueueItem[];
        try {
            normalizedItems = normalizeQueueItems(items);
        } catch (error) {
            rejectRequest(res, 400, error instanceof Error ? error.message : 'Invalid queue items', 'invalid_items', { route, roomId, userId });
            return;
        }

        const existing = sessions.get(roomId);
        if (existing) {
            if (videoMode === true && !existing.videoMode) {
                rejectRequest(res, 409, 'Video mode is locked for the current session', 'video_mode_locked', {
                    route,
                    roomId,
                    userId,
                });
                return;
            }
            existing.addItems(normalizedItems);
            getRequestLogger(res).info('queue.add.success', { route, roomId, userId, addedCount: normalizedItems.length });
            respondWithSession(res, roomId, existing);
            return;
        }

        const resolvedVideoMode = resolveVideoMode(normalizedItems[0].url, videoMode === true);
        const session = createSession(roomId, normalizedItems, resolvedVideoMode);
        try {
            getRequestLogger(res).info('bot.start.begin', { route, roomId, userId, resolvedVideoMode });
            await session.start();
            getRequestLogger(res).info('bot.start.success', { route, roomId, userId, resolvedVideoMode });
            respondWithSession(res, roomId, session, { videoMode: resolvedVideoMode });
        } catch (error) {
            getRequestLogger(res).error('bot.start.failed', {
                route,
                roomId,
                userId,
                resolvedVideoMode,
                error: formatErrorForLog(error),
            });
            session.destroy('bot_start_failed');
            const msg = error instanceof Error ? error.message : String(error);
            res.status(500).json({ error: msg });
        }
    });

    router.post('/queue/play', async (req: Request, res: Response) => {
        const route = '/queue/play';
        const { roomId, itemId } = req.body as { roomId?: string; itemId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!isValidId(itemId)) {
            rejectRequest(res, 400, 'itemId is required', 'missing_item_id', { route, roomId, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        try {
            session.playItem(itemId);
            getRequestLogger(res).info('queue.play.success', { route, roomId, userId, itemId });
            respondWithSession(res, roomId, session);
        } catch (error) {
            rejectRequest(res, 404, error instanceof Error ? error.message : 'Queue item not found', 'queue_item_not_found', {
                route,
                roomId,
                userId,
                itemId,
            });
        }
    });

    router.post('/queue/remove', async (req: Request, res: Response) => {
        const route = '/queue/remove';
        const { roomId, itemId } = req.body as { roomId?: string; itemId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!isValidId(itemId)) {
            rejectRequest(res, 400, 'itemId is required', 'missing_item_id', { route, roomId, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        try {
            const nextState = session.removeItem(itemId);
            getRequestLogger(res).info('queue.remove.success', { route, roomId, userId, itemId });
            if (!nextState || !sessions.has(roomId)) {
                res.json({ ok: true, roomId, session: null });
                return;
            }
            respondWithSession(res, roomId, session);
        } catch (error) {
            rejectRequest(res, 404, error instanceof Error ? error.message : 'Queue item not found', 'queue_item_not_found', {
                route,
                roomId,
                userId,
                itemId,
            });
        }
    });

    router.post('/queue/clear', async (req: Request, res: Response) => {
        const route = '/queue/clear';
        const { roomId } = req.body as { roomId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        session.clear();
        getRequestLogger(res).info('queue.clear.success', { route, roomId, userId });
        res.json({ ok: true, roomId });
    });

    router.post('/queue/reorder', async (req: Request, res: Response) => {
        const route = '/queue/reorder';
        const { roomId, itemIds } = req.body as { roomId?: string; itemIds?: string[] };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!Array.isArray(itemIds) || itemIds.length === 0 || !itemIds.every((itemId) => isValidId(itemId))) {
            rejectRequest(res, 400, 'itemIds must be a non-empty string array', 'invalid_item_ids', { route, roomId, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        try {
            session.reorder(itemIds);
            getRequestLogger(res).info('queue.reorder.success', { route, roomId, userId });
            respondWithSession(res, roomId, session);
        } catch (error) {
            rejectRequest(res, 400, error instanceof Error ? error.message : 'Invalid queue reorder', 'invalid_item_ids', {
                route,
                roomId,
                userId,
            });
        }
    });

    router.post('/queue/shuffle', async (req: Request, res: Response) => {
        const route = '/queue/shuffle';
        const { roomId } = req.body as { roomId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        session.shuffle();
        getRequestLogger(res).info('queue.shuffle.success', { route, roomId, userId });
        respondWithSession(res, roomId, session);
    });

    router.post('/queue/next', async (req: Request, res: Response) => {
        const route = '/queue/next';
        const { roomId } = req.body as { roomId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;
        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        const nextState = session.next();
        getRequestLogger(res).info('queue.next.success', { route, roomId, userId });
        if (!nextState || !sessions.has(roomId)) {
            res.json({ ok: true, roomId, session: null });
            return;
        }
        respondWithSession(res, roomId, session);
    });

    router.post('/leave', async (req: Request, res: Response) => {
        const route = '/leave';
        const { roomId } = req.body as { roomId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        session.destroy('manual');
        getRequestLogger(res).info('bot.leave.success', { route, roomId, userId });
        res.json({ ok: true, roomId });
    });

    router.post('/pause', async (req: Request, res: Response) => {
        const route = '/pause';
        const { roomId } = req.body as { roomId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        session.pause();
        getRequestLogger(res).info('bot.pause.success', { route, roomId, userId });
        respondWithSession(res, roomId, session);
    });

    router.post('/resume', async (req: Request, res: Response) => {
        const route = '/resume';
        const { roomId } = req.body as { roomId?: string };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        session.resume();
        getRequestLogger(res).info('bot.resume.success', { route, roomId, userId });
        respondWithSession(res, roomId, session);
    });

    router.post('/seek', async (req: Request, res: Response) => {
        const route = '/seek';
        const { roomId, seconds } = req.body as { roomId?: string; seconds?: unknown };
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        if (!isValidId(roomId)) {
            rejectRequest(res, 400, 'roomId is required', 'missing_room_id', { route, userId });
            return;
        }
        if (typeof seconds !== 'number' || !isFinite(seconds)) {
            rejectRequest(res, 400, 'seconds must be a finite number', 'invalid_seconds', { route, roomId, userId });
            return;
        }
        if (!await ensureRoomAccess(req, res, route, roomId)) return;

        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        session.seek(Math.max(0, seconds) * 1000);
        getRequestLogger(res).info('bot.seek.success', { route, roomId, userId, seconds });
        respondWithSession(res, roomId, session, { seconds });
    });

    router.post('/resolve', async (req: Request, res: Response) => {
        const route = '/resolve';
        const { url } = req.body as { url?: string };
        setRouteContext(res, route, { url });

        if (!isValidUrl(url)) {
            rejectRequest(res, 400, 'url is required', 'missing_url', { route });
            return;
        }
        const resolveUrlFailure = getUrlValidationFailure(url);
        if (resolveUrlFailure) {
            rejectRequest(res, 400, 'URL domain not permitted', resolveUrlFailure, { route, url });
            return;
        }

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        const rateLimit = evaluateUserRateLimit(userId);
        if (!rateLimit.allowed) {
            rejectRequest(res, 429, 'Too many requests, please slow down', 'rate_limited', {
                route,
                userId,
                requestCount: rateLimit.count,
                resetAt: new Date(rateLimit.resetAt).toISOString(),
            });
            return;
        }

        try {
            const items = await resolveUrl(url, getRequestLogger(res).child('resolve', { route, userId }));
            res.json({ items });
        } catch (error) {
            getRequestLogger(res).error('resolve.failed', {
                route,
                userId,
                error: formatErrorForLog(error),
            });
            const msg = error instanceof Error ? error.message : String(error);
            res.status(500).json({ error: msg });
        }
    });

    router.get('/rooms', async (req: Request, res: Response) => {
        const route = '/rooms';
        setRouteContext(res, route);

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        const roomIds = [...sessions.keys()];
        const accessibleRooms = await Promise.all(roomIds.map(async (roomId) => (
            await checkRoomAccess(roomId, req.headers.authorization, getRequestLogger(res).child('roomList', { route, roomId, userId }))
                ? roomId
                : null
        )));

        getRequestLogger(res).info('rooms.list.success', {
            route,
            userId,
            roomCount: accessibleRooms.filter((room): room is string => room !== null).length,
        });
        res.json({ rooms: accessibleRooms.filter((roomId): roomId is string => roomId !== null) });
    });

    router.get('/status/:roomId', async (req: Request, res: Response) => {
        const route = '/status/:roomId';
        const { roomId } = req.params;
        setRouteContext(res, route, { roomId });

        const userId = authorizeRequest(req, res, route);
        if (!userId) return;

        if (!await ensureRoomAccess(req, res, route, roomId)) return;
        const session = sessions.get(roomId);
        if (!session) {
            rejectRequest(res, 404, `No bot in room "${roomId}"`, 'bot_not_found', { route, roomId, userId });
            return;
        }

        getRequestLogger(res).info('bot.status.success', { route, roomId, userId });
        res.json(session.getState());
    });

    return router;
}

export { extractUserId, checkUserRateLimit, secondsToTimestamp, isAllowedUrl };
