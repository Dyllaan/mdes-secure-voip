import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { spawn } from 'child_process';
import { config } from './config';
import { login, startTokenRefresh, getToken, fetchTurnCredentials, getTurnCredentials } from './Auth';
import { BotInstance } from './BotInstance';
import { HubHandler } from './HubHandler';

// ── Media URL allowlist ───────────────────────────────────────────────────────
const ALLOWED_MEDIA_DOMAINS = (process.env.ALLOWED_MEDIA_DOMAINS ?? 'youtube.com,youtu.be,soundcloud.com,spotify.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

function isAllowedUrl(url: string): boolean {
    try {
        const { hostname } = new URL(url);
        const h = hostname.toLowerCase();
        return ALLOWED_MEDIA_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

// ── Per-user rate limiting ────────────────────────────────────────────────────
const USER_PLAY_LIMIT = 5;
const USER_PLAY_WINDOW_MS = 60_000;
const userPlayLimits = new Map<string, { count: number; resetAt: number }>();

function extractUserId(authHeader: string | undefined): string {
    // Decode JWT payload (Base64url) to extract sub — no sig check needed for rate keying.
    // Auth enforcement happens at the gateway level.
    if (!authHeader?.startsWith('Bearer ')) return 'anonymous';
    const parts = authHeader.slice(7).split('.');
    if (parts.length !== 3) return 'anonymous';
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return typeof payload.sub === 'string' && payload.sub ? payload.sub : 'anonymous';
    } catch {
        return 'anonymous';
    }
}

function checkUserRateLimit(userId: string): boolean {
    const now = Date.now();
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

function resolveUrl(url: string): Promise<ResolvedItem[]> {
    return new Promise((resolve, reject) => {
        const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

        const isSoundCloud = /soundcloud\.com/i.test(url);
        const isSCSingle   = isSoundCloud && !/\/sets\//.test(url) && (() => {
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

function makeBotInstance(roomId: string, youtubeUrl: string, videoMode: boolean): BotInstance {
    return new BotInstance(roomId, youtubeUrl, getToken(), getTurnCredentials(), videoMode);
}

const app  = express();
const bots = new Map<string, BotInstance>();

app.use(express.json());

app.post('/hub/join', async (req: Request, res: Response) => {
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

app.post('/join', async (req: Request, res: Response) => {
    const { roomId, youtubeUrl, videoMode = false } =
        req.body as { roomId?: string; youtubeUrl?: string; videoMode?: boolean };

    if (!roomId)     return res.status(400).json({ error: 'roomId is required' });
    if (!youtubeUrl) return res.status(400).json({ error: 'youtubeUrl is required' });

    if (!isAllowedUrl(youtubeUrl)) return res.status(400).json({ error: 'URL domain not permitted' });

    const userId = extractUserId(req.headers.authorization);
    if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

    if (bots.has(roomId)) {
        return res.status(409).json({ error: `Bot is already in room "${roomId}"` });
    }

    const bot = makeBotInstance(roomId, youtubeUrl, videoMode);
    bot.setAutoLeaveCallback(() => {
        bot.destroy();
        bots.delete(roomId);
    });
    bots.set(roomId, bot);

    try {
        await bot.start();
        return res.json({ ok: true, roomId, videoMode });
    } catch (err: unknown) {
        bots.delete(roomId);
        bot.destroy();
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});

app.post('/play', async (req: Request, res: Response) => {
    const { roomId, youtubeUrl, videoMode = false } =
        req.body as { roomId?: string; youtubeUrl?: string; videoMode?: boolean };

    if (!roomId)     return res.status(400).json({ error: 'roomId is required' });
    if (!youtubeUrl) return res.status(400).json({ error: 'youtubeUrl is required' });

    if (!isAllowedUrl(youtubeUrl)) return res.status(400).json({ error: 'URL domain not permitted' });

    const userId = extractUserId(req.headers.authorization);
    if (!checkUserRateLimit(userId)) return res.status(429).json({ error: 'Too many requests, please slow down' });

    const existing = bots.get(roomId);
    if (existing) {
        existing.changeTrack(youtubeUrl);
        return res.json({ ok: true, roomId, action: 'changeTrack' });
    }

    const bot = makeBotInstance(roomId, youtubeUrl, videoMode);
    bot.setAutoLeaveCallback(() => {
        bot.destroy();
        bots.delete(roomId);
    });
    bots.set(roomId, bot);

    try {
        await bot.start();
        return res.json({ ok: true, roomId, action: 'join', videoMode });
    } catch (err: unknown) {
        bots.delete(roomId);
        bot.destroy();
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: msg });
    }
});

app.post('/leave', (req: Request, res: Response) => {
    const { roomId } = req.body as { roomId?: string };
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });

    const bot = bots.get(roomId);
    if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

    bot.destroy();
    bots.delete(roomId);
    return res.json({ ok: true, roomId });
});

app.post('/pause', (req: Request, res: Response) => {
    const { roomId } = req.body as { roomId?: string };
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });

    const bot = bots.get(roomId);
    if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

    bot.pause();
    return res.json({ ok: true, roomId });
});

app.post('/resume', (req: Request, res: Response) => {
    const { roomId } = req.body as { roomId?: string };
    if (!roomId) return res.status(400).json({ error: 'roomId is required' });

    const bot = bots.get(roomId);
    if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

    bot.resume();
    return res.json({ ok: true, roomId });
});

app.post('/seek', (req: Request, res: Response) => {
    const { roomId, seconds } = req.body as { roomId?: string; seconds?: number };

    if (!roomId)              return res.status(400).json({ error: 'roomId is required' });
    if (seconds === undefined) return res.status(400).json({ error: 'seconds is required' });

    const bot = bots.get(roomId);
    if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

    bot.seek(Math.max(0, seconds) * 1000);
    return res.json({ ok: true, roomId, seconds });
});

app.post('/resolve', async (req: Request, res: Response) => {
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

app.get('/rooms', (_req: Request, res: Response) => {
    return res.json({ rooms: [...bots.keys()] });
});

app.get('/status/:roomId', (req: Request, res: Response) => {
    const { roomId } = req.params;
    const bot = bots.get(roomId);
    if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });
    return res.json(bot.getStatus());
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Unhandled]', err);
    res.status(500).json({ error: err.message });
});

(async () => {
    try {
        await login();
        await fetchTurnCredentials();
        startTokenRefresh();
        app.listen(config.PORT, () => {
            console.log(`[Boot] Musicman listening on :${config.PORT}`);
        });
    } catch (err) {
        console.error('[Boot] Fatal:', err);
        process.exit(1);
    }
})();

const shutdown = () => {
    for (const [, bot] of bots) bot.destroy();
    process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);