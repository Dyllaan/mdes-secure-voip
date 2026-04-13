import { type Request, type Response, type Router } from 'express';
import express from 'express';
import { getToken, getTurnCredentials } from '../Auth';
import { BotInstance } from '../instances/BotInstance';
import { AVBotInstance } from '../instances/AVBotInstance';
import { HubHandler } from '../HubHandler';
import { config } from '../config';

const ALLOWED_AUDIO_ORIGINS = (config.ALLOWED_AUDIO_ORIGINS ?? 'youtube.com,youtu.be,soundcloud.com,spotify.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

const ALLOWED_VIDEO_ORIGINS = (config.ALLOWED_VIDEO_ORIGINS ?? 'youtube.com,youtu.be')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

function isAllowedUrl(url: string): boolean {
    try {
        const { hostname } = new URL(url);
        const h = hostname.toLowerCase();
        return ALLOWED_AUDIO_ORIGINS.some((d) => h === d || h.endsWith(`.${d}`)) || ALLOWED_VIDEO_ORIGINS.some((d) => h === d || h.endsWith(`.${d}`));
    } catch {
        return false;
    }
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

import { createHmac, timingSafeEqual } from 'crypto';

const _jwtSecretRaw = config.JWT_SECRET;
let _jwtSecret: Buffer;
try {
    _jwtSecret = Buffer.from(_jwtSecretRaw, 'base64');
    if (_jwtSecret.length === 0) throw new Error('empty after base64 decode');
} catch {
    _jwtSecret = Buffer.from(_jwtSecretRaw);
}

function extractUserId(authHeader: string | undefined): string {
    if (!authHeader?.startsWith('Bearer ')) return 'anonymous';
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return 'anonymous';
    try {
        const signingInput  = `${parts[0]}.${parts[1]}`;
        const expectedSig   = createHmac('sha256', _jwtSecret).update(signingInput).digest('base64url');
        const actualSig     = Buffer.from(parts[2], 'base64url');
        const expectedSigBuf = Buffer.from(expectedSig, 'base64url');
        if (actualSig.length !== expectedSigBuf.length || !timingSafeEqual(actualSig, expectedSigBuf)) {
            return 'anonymous';
        }
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return 'anonymous';
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

export function createRouter(bots: Map<string, BotInstance>): Router {
    const router = express.Router();

    router.post('/hub/join', async (req: Request, res: Response) => {
        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        const { hubId } = req.body as { hubId?: string };
        if (!hubId) return res.status(400).json({ error: 'hubId is required' });

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
        const { roomId, url, videoMode = false } =
            req.body as { roomId?: string; url?: string; videoMode?: boolean };

        if (!roomId)     return res.status(400).json({ error: 'roomId is required' });
        if (!url) return res.status(400).json({ error: 'url is required' });
        if (!isAllowedUrl(url)) return res.status(400).json({ error: 'URL domain not permitted' });

        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        if (!await checkRoomAccess(roomId, req.headers.authorization)) {
            return res.status(403).json({ error: 'Not a member of this room' });
        }

        if (bots.has(roomId)) {
            return res.status(409).json({ error: `Bot is already in room "${roomId}"` });
        }

        const resolvedVideoMode = resolveVideoMode(url, videoMode);

        const bot = makeBotInstance(roomId, url, resolvedVideoMode);
        bot.setAutoLeaveCallback(() => { bot.destroy(); bots.delete(roomId); });
        bots.set(roomId, bot);

        try {
            await bot.start();
            return res.json({ ok: true, roomId, videoMode: resolvedVideoMode });
        } catch (err: unknown) {
            bots.delete(roomId);
            bot.destroy();
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: msg });
        }
    });

    router.post('/play', async (req: Request, res: Response) => {
        const { roomId, url, videoMode = false } =
            req.body as { roomId?: string; url?: string; videoMode?: boolean };

        if (!roomId)     return res.status(400).json({ error: 'roomId is required' });
        if (!url) return res.status(400).json({ error: 'url is required' });
        if (!isAllowedUrl(url)) return res.status(400).json({ error: 'URL domain not permitted' });

        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        if (!await checkRoomAccess(roomId, req.headers.authorization)) {
            return res.status(403).json({ error: 'Not a member of this room' });
        }

        const resolvedVideoMode = resolveVideoMode(url, videoMode);

        const existing = bots.get(roomId);
        if (existing) {

            if (existing.videoMode !== resolvedVideoMode) {
                existing.destroy();
                bots.delete(roomId);
                // falls through to spawn the correct type below
            } else {
                existing.changeTrack(url);
                return res.json({ ok: true, roomId, action: 'changeTrack', videoMode: resolvedVideoMode });
            }
        }

        const bot = makeBotInstance(roomId, url, resolvedVideoMode);
        bot.setAutoLeaveCallback(() => { bot.destroy(); bots.delete(roomId); });
        bots.set(roomId, bot);

        try {
            await bot.start();
            return res.json({ ok: true, roomId, action: 'join', videoMode: resolvedVideoMode });
        } catch (err: unknown) {
            bots.delete(roomId);
            bot.destroy();
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: msg });
        }
    });

    router.post('/leave', (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.body as { roomId?: string };
        if (!roomId) return res.status(400).json({ error: 'roomId is required' });

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.destroy();
        bots.delete(roomId);
        return res.json({ ok: true, roomId });
    });

    router.post('/pause', (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.body as { roomId?: string };
        if (!roomId) return res.status(400).json({ error: 'roomId is required' });

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.pause();
        return res.json({ ok: true, roomId });
    });

    router.post('/resume', (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.body as { roomId?: string };
        if (!roomId) return res.status(400).json({ error: 'roomId is required' });

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.resume();
        return res.json({ ok: true, roomId });
    });

    router.post('/seek', (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId, seconds } = req.body as { roomId?: string; seconds?: number };
        if (!roomId)              return res.status(400).json({ error: 'roomId is required' });
        if (seconds === undefined) return res.status(400).json({ error: 'seconds is required' });

        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

        bot.seek(Math.max(0, seconds) * 1000);
        return res.json({ ok: true, roomId, seconds });
    });

    router.post('/resolve', async (req: Request, res: Response) => {
        const { url } = req.body as { url?: string };
        if (!url) return res.status(400).json({ error: 'url is required' });
        if (!isAllowedUrl(url)) return res.status(400).json({ error: 'URL domain not permitted' });

        const userId = extractUserId(req.headers.authorization);
        if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

        try {
            const items = await resolveUrl(url);
            return res.json({ items });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: msg });
        }
    });

    router.get('/rooms', (req: Request, res: Response) => {
        if (extractUserId(req.headers.authorization) === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });
        return res.json({ rooms: [...bots.keys()] });
    });

    router.get('/status/:roomId', (req: Request, res: Response) => {
        const userId = extractUserId(req.headers.authorization);
        if (userId === 'anonymous') return res.status(401).json({ error: 'Unauthorized' });

        const { roomId } = req.params;
        const bot = bots.get(roomId);
        if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });
        return res.json(bot.getStatus());
    });

    return router;
}

export { extractUserId, checkUserRateLimit, secondsToTimestamp, isAllowedUrl };