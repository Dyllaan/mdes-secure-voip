import { type Request, type Response, type Router } from 'express';
import express from 'express';
import { getToken, getTurnCredentials } from '../Auth';
import { BotInstance } from '../instances/BotInstance';
import { AVBotInstance } from '../instances/AVBotInstance';
import { HubHandler } from '../HubHandler';
import { config } from '../config';
import { formatErrorForLog, truncateForLog } from '../logging';

const ALLOWED_AUDIO_ORIGINS = (config.ALLOWED_AUDIO_ORIGINS ?? 'youtube.com,youtu.be,soundcloud.com,spotify.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

const ALLOWED_VIDEO_ORIGINS = (config.ALLOWED_VIDEO_ORIGINS ?? 'youtube.com,youtu.be')
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
        return  ALLOWED_VIDEO_ORIGINS.some((d) => h === d || h.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

const USER_PLAY_LIMIT     = 5;
const USER_PLAY_WINDOW_MS = 60_000;
const userPlayLimits      = new Map<string, { count: number; resetAt: number }>();

import { createVerify } from 'crypto';

const _jwtPublicKey = Buffer.from(config.JWT_PUBLIC_KEY_B64, 'base64').toString('utf8');

function hasAudience(payload: Record<string, unknown>, audience: string): boolean {
    const aud = payload.aud;
    if (typeof aud === 'string') {
        return aud === audience;
    }
    if (Array.isArray(aud)) {
        return aud.includes(audience);
    }
    return false;
}

function extractUserId(authHeader: string | undefined): string {
    if (!authHeader?.startsWith('Bearer ')) return 'anonymous';
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return 'anonymous';
    try {
        const signingInput  = `${parts[0]}.${parts[1]}`;
        const signature = Buffer.from(parts[2], 'base64url');
        const verified = createVerify('RSA-SHA256').update(signingInput).end().verify(_jwtPublicKey, signature);
        if (!verified) {
            return 'anonymous';
        }
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
        if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return 'anonymous';
        if (payload.iss !== config.JWT_ISSUER) return 'anonymous';
        if (payload.token_use !== 'access') return 'anonymous';
        if (!hasAudience(payload, config.JWT_ACCESS_AUDIENCE)) return 'anonymous';
        return typeof payload.sub === 'string' && payload.sub ? payload.sub : 'anonymous';
    } catch {
        return 'anonymous';
    }
}

async function checkRoomAccess(roomId: string, authHeader: string | undefined): Promise<boolean> {
    if (!authHeader?.startsWith('Bearer ')) return false;
    try {
        const res = await fetch(`${config.HUB_SERVICE_URL}/channels/${roomId}/access`, {
            headers: { Authorization: authHeader },
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function ensureRoomAccess(
    roomId: string,
    authHeader: string | undefined,
    res: Response,
): Promise<boolean> {
    if (!await checkRoomAccess(roomId, authHeader)) {
        res.status(403).json({ error: 'Not a member of this room' });
        return false;
    }
    return true;
}

function checkUserRateLimit(userId: string): boolean {
    const now   = Date.now();
    const entry = userPlayLimits.get(userId) ?? { count: 0, resetAt: now + USER_PLAY_WINDOW_MS };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + USER_PLAY_WINDOW_MS; }
    entry.count++;
    userPlayLimits.set(userId, entry);
    return entry.count <= USER_PLAY_LIMIT;
}

interface ResolvedItem {
    id:         string;
    url:        string;
    title:      string;
    channel:    string;
    duration:   string;
    durationMs: number;
}

function secondsToTimestamp(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

import { spawn } from 'child_process';

function resolveUrl(url: string): Promise<ResolvedItem[]> {
    return new Promise((resolve, reject) => {
        const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

        const isSoundCloud  = /soundcloud\.com/i.test(url);
        const isSCSingle    = isSoundCloud && !/\/sets\//.test(url) && (() => {
            try { return new URL(url).pathname.split('/').filter(Boolean).length === 2; } catch { return false; }
        })();
        const useFlatPlaylist = !isSCSingle;

        const maxMb = process.env.YTDLP_MAX_FILESIZE_MB ?? '50';
        const args  = [
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

        const ytdlp = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';
        ytdlp.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
        ytdlp.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

        const timeout = setTimeout(() => {
            ytdlp.kill('SIGTERM');
            reject(new Error('yt-dlp resolve timed out'));
        }, isSCSingle ? 60_000 : 30_000);

        ytdlp.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            try {
                const data    = JSON.parse(stdout);
                const entries: Record<string, unknown>[] = data.entries ?? [data];
                const items: ResolvedItem[] = entries
                    .filter((e) => e && e.id)
                    .map((e) => ({
                        id:         String(e.id),
                        url:        String(e.webpage_url ?? e.url ?? `https://www.youtube.com/watch?v=${e.id}`),
                        title:      String(e.title ?? e.id),
                        channel:    String(e.channel ?? e.uploader ?? 'Unknown'),
                        duration:   typeof e.duration === 'number' ? secondsToTimestamp(e.duration) : '-',
                        durationMs: typeof e.duration === 'number' ? Math.round(e.duration * 1000) : 0,
                    }));
                resolve(items);
            } catch {
                reject(new Error('Failed to parse yt-dlp output'));
            }
        });

        ytdlp.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
}

function makeBotInstance(roomId: string, url: string, videoMode: boolean): BotInstance {
    const token = getToken();
    const creds = getTurnCredentials();
    return videoMode
        ? new AVBotInstance(roomId, url, token, creds)
        : new BotInstance(roomId, url, token, creds);
}

const MAX_URL_LENGTH    = 2048;
const MAX_ID_LENGTH     = 128;

function isValidId(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

function isValidUrl(url: unknown): url is string {
    return typeof url === 'string' && url.length > 0 && url.length <= MAX_URL_LENGTH;
}

function logRouteFailure(
    route: '/join' | '/play' | '/resolve',
    reason: string,
    details: {
        roomId?: unknown;
        url?: unknown;
        requestedVideoMode?: unknown;
        resolvedVideoMode?: boolean;
        error?: unknown;
    },
): void {
    console.warn('[MusicmanRoute] Request rejected', {
        route,
        reason,
        roomId: typeof details.roomId === 'string' ? details.roomId : undefined,
        url: typeof details.url === 'string' ? truncateForLog(details.url) : undefined,
        requestedVideoMode: details.requestedVideoMode === true,
        resolvedVideoMode: details.resolvedVideoMode,
        ...(details.error !== undefined ? { error: formatErrorForLog(details.error) } : {}),
    });
}

export function createRouter(bots: Map<string, BotInstance>): Router {
    const router = express.Router();

    router.post('/hub/join', async (req: Request, res: Response) => {
        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        const { hubId } = req.body as { hubId?: string };
        if (!isValidId(hubId)) return res.status(400).json({ error: 'hubId is required' });

        let token: string;
        try {
            token = getToken();
        } catch {
            return res.status(503).json({ error: 'Bot is not authenticated yet - retry in a moment' });
        }

        try {
            await HubHandler.joinHub(hubId, token);
            return res.json({ ok: true });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(403).json({ error: msg });
        }
    });

    router.post('/join', async (req: Request, res: Response) => {
        const { roomId, url, videoMode } = req.body as { roomId?: string; url?: string; videoMode?: unknown };

        if (!isValidId(roomId))  return res.status(400).json({ error: 'roomId is required' });
        if (!isValidUrl(url)) {
            logRouteFailure('/join', 'missing_url', { roomId, url, requestedVideoMode: videoMode });
            return res.status(400).json({ error: 'url is required' });
        }
        const joinUrlFailure = getUrlValidationFailure(url);
        if (joinUrlFailure) {
            logRouteFailure('/join', joinUrlFailure, { roomId, url, requestedVideoMode: videoMode });
            return res.status(400).json({ error: 'URL domain not permitted' });
        }

        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) {
            logRouteFailure('/join', 'room_access_denied', { roomId, url, requestedVideoMode: videoMode });
            return;
        }

        if (bots.has(roomId)) {
            return res.status(409).json({ error: `Bot is already in room "${roomId}"` });
        }

        const resolvedVideoMode = resolveVideoMode(url, videoMode === true);

        const bot = makeBotInstance(roomId, url, resolvedVideoMode);
        bot.setAutoLeaveCallback(() => { bot.destroy('auto_leave'); bots.delete(roomId); });
        bots.set(roomId, bot);

        try {
            await bot.start();
            return res.json({ ok: true, roomId, videoMode: resolvedVideoMode });
        } catch (err: unknown) {
            bots.delete(roomId);
            logRouteFailure('/join', 'bot_start_failed', {
                roomId,
                url,
                requestedVideoMode: videoMode,
                resolvedVideoMode,
                error: err,
            });
            bot.destroy('bot_start_failed');
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: msg });
        }
    });

    router.post('/play', async (req: Request, res: Response) => {
        const { roomId, url, videoMode } = req.body as { roomId?: string; url?: string; videoMode?: unknown };

        if (!isValidId(roomId))  return res.status(400).json({ error: 'roomId is required' });
        if (!isValidUrl(url)) {
            logRouteFailure('/play', 'missing_url', { roomId, url, requestedVideoMode: videoMode });
            return res.status(400).json({ error: 'url is required' });
        }
        const playUrlFailure = getUrlValidationFailure(url);
        if (playUrlFailure) {
            logRouteFailure('/play', playUrlFailure, { roomId, url, requestedVideoMode: videoMode });
            return res.status(400).json({ error: 'URL domain not permitted' });
        }

        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) {
            logRouteFailure('/play', 'room_access_denied', { roomId, url, requestedVideoMode: videoMode });
            return;
        }

        const resolvedVideoMode = resolveVideoMode(url, videoMode === true);

        const existing = bots.get(roomId);
        if (existing) {

            if (existing.videoMode !== resolvedVideoMode) {
                existing.destroy('video_mode_switch');
                bots.delete(roomId);
                // falls through to spawn the correct type below
            } else {
                existing.changeTrack(url);
                return res.json({ ok: true, roomId, action: 'changeTrack', videoMode: resolvedVideoMode });
            }
        }

        const bot = makeBotInstance(roomId, url, resolvedVideoMode);
        bot.setAutoLeaveCallback(() => { bot.destroy('auto_leave'); bots.delete(roomId); });
        bots.set(roomId, bot);

        try {
            await bot.start();
            return res.json({ ok: true, roomId, action: 'join', videoMode: resolvedVideoMode });
        } catch (err: unknown) {
            bots.delete(roomId);
            logRouteFailure('/play', 'bot_start_failed', {
                roomId,
                url,
                requestedVideoMode: videoMode,
                resolvedVideoMode,
                error: err,
            });
            bot.destroy('bot_start_failed');
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: msg });
        }
    });

    router.post('/leave', async (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.body as { roomId?: string };
        if (!isValidId(roomId)) return res.status(400).json({ error: 'roomId is required' });
        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) return;

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.destroy('manual');
        bots.delete(roomId);
        return res.json({ ok: true, roomId });
    });

    router.post('/pause', async (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.body as { roomId?: string };
        if (!isValidId(roomId)) return res.status(400).json({ error: 'roomId is required' });
        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) return;

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.pause();
        return res.json({ ok: true, roomId });
    });

    router.post('/resume', async (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.body as { roomId?: string };
        if (!isValidId(roomId)) return res.status(400).json({ error: 'roomId is required' });
        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) return;

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.resume();
        return res.json({ ok: true, roomId });
    });

    router.post('/seek', async (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId, seconds } = req.body as { roomId?: string; seconds?: unknown };
        if (!isValidId(roomId))                                     return res.status(400).json({ error: 'roomId is required' });
        if (typeof seconds !== 'number' || !isFinite(seconds))      return res.status(400).json({ error: 'seconds must be a finite number' });
        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) return;

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.seek(Math.max(0, seconds) * 1000);
        return res.json({ ok: true, roomId, seconds });
    });

    router.post('/resolve', async (req: Request, res: Response) => {
        const { url } = req.body as { url?: string };
        if (!isValidUrl(url)) {
            logRouteFailure('/resolve', 'missing_url', { url });
            return res.status(400).json({ error: 'url is required' });
        }
        const resolveUrlFailure = getUrlValidationFailure(url);
        if (resolveUrlFailure) {
            logRouteFailure('/resolve', resolveUrlFailure, { url });
            return res.status(400).json({ error: 'URL domain not permitted' });
        }

        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        try {
            const items = await resolveUrl(url);
            return res.json({ items });
        } catch (err: unknown) {
            logRouteFailure('/resolve', 'resolve_failed', { url, error: err });
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: msg });
        }
    });

    router.get('/rooms', async (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const roomIds = [...bots.keys()];
        const accessibleRooms = await Promise.all(roomIds.map(async (roomId) => (
            await checkRoomAccess(roomId, req.headers.authorization) ? roomId : null
        )));

        return res.json({ rooms: accessibleRooms.filter((roomId): roomId is string => roomId !== null) });
    });

    router.get('/status/:roomId', async (req: Request, res: Response) => {
        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.params;
        if (!await ensureRoomAccess(roomId, req.headers.authorization, res)) return;
        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });
        return res.json(bot.getStatus());
    });

    return router;
}

export { extractUserId, checkUserRateLimit, secondsToTimestamp, isAllowedUrl };
