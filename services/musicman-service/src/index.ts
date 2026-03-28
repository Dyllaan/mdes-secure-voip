import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { spawn } from 'child_process';
import { config } from './config';
import { login, startTokenRefresh, getToken } from './auth';
import { BotInstance } from './BotInstance';
import { HubHandler } from './HubHandler';

// ── Playlist resolver ─────────────────────────────────────────────────────────

interface ResolvedItem {
  id:         string;
  title:      string;
  channel:    string;
  duration:   string;   // "mm:ss" or "h:mm:ss"
  durationMs: number;
}

function secondsToTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Use yt-dlp --flat-playlist -J to resolve a URL to individual video entries.
 * Works for single videos and playlists.  Times out after 30 seconds.
 */
function resolveUrl(url: string): Promise<ResolvedItem[]> {
  return new Promise((resolve, reject) => {
    const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

    const args = [
      '--flat-playlist',
      '-J',
      '--no-warnings',
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
    }, 30_000);

    ytdlp.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      try {
        const data = JSON.parse(stdout);
        // Single video: { _type: 'video', id, title, duration, channel/uploader }
        // Playlist:     { _type: 'playlist', entries: [...] }
        const entries: Record<string, unknown>[] = data.entries ?? [data];
        const items: ResolvedItem[] = entries
          .filter((e) => e && e.id)
          .map((e) => ({
            id:         String(e.id),
            title:      String(e.title ?? e.id),
            channel:    String(e.channel ?? e.uploader ?? 'YouTube'),
            duration:   typeof e.duration === 'number' ? secondsToTimestamp(e.duration) : '—',
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

const app  = express();
const bots = new Map<string, BotInstance>();

app.use(express.json());

/**
 * POST /hub/join
 * Body: { hubId: string }
 * Joins a hub using its ID.
 */
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
        console.error(`[/hub/join] Failed to join hub:`, msg);
        return res.status(403).json({ error: msg });
    }
});

/**
 * POST /join
 * Body: { roomId: string, youtubeUrl: string }
 * Spawns a bot in a voice channel. Bot must already be a hub member.
 * Returns 409 if the bot is already in the room — use POST /play instead,
 * which handles both join and track change.
 */
app.post('/join', async (req: Request, res: Response) => {
  const { roomId, youtubeUrl } = req.body as {
    roomId?:     string;
    youtubeUrl?: string;
  };

  if (!roomId)     return res.status(400).json({ error: 'roomId is required' });
  if (!youtubeUrl) return res.status(400).json({ error: 'youtubeUrl is required' });

  if (bots.has(roomId)) {
    return res.status(409).json({ error: `Bot is already in room "${roomId}"` });
  }

  let token: string;
  try {
    token = getToken();
  } catch {
    return res.status(503).json({ error: 'Bot is not authenticated yet - retry in a moment' });
  }

  const bot = new BotInstance(roomId, youtubeUrl, token);
  bots.set(roomId, bot);

  try {
    await bot.start();
    console.log(`[/join] Bot started in room: ${roomId}`);
    return res.json({ ok: true, roomId });
  } catch (err: unknown) {
    bots.delete(roomId);
    bot.destroy();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/join] Failed for room "${roomId}":`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /play
 * Body: { roomId: string, youtubeUrl: string }
 * If the bot is not yet in the room: joins and starts streaming.
 * If the bot is already in the room: swaps the track without disrupting WebRTC connections.
 */
app.post('/play', async (req: Request, res: Response) => {
  const { roomId, youtubeUrl } = req.body as {
    roomId?:     string;
    youtubeUrl?: string;
  };

  if (!roomId)     return res.status(400).json({ error: 'roomId is required' });
  if (!youtubeUrl) return res.status(400).json({ error: 'youtubeUrl is required' });

  const existing = bots.get(roomId);
  if (existing) {
    existing.changeTrack(youtubeUrl);
    console.log(`[/play] Track changed in room: ${roomId}`);
    return res.json({ ok: true, roomId, action: 'changeTrack' });
  }

  let token: string;
  try {
    token = getToken();
  } catch {
    return res.status(503).json({ error: 'Bot is not authenticated yet - retry in a moment' });
  }

  const bot = new BotInstance(roomId, youtubeUrl, token);
  bots.set(roomId, bot);

  try {
    await bot.start();
    console.log(`[/play] Bot started in room: ${roomId}`);
    return res.json({ ok: true, roomId, action: 'join' });
  } catch (err: unknown) {
    bots.delete(roomId);
    bot.destroy();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/play] Failed for room "${roomId}":`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /leave
 * Body: { roomId: string }
 * Gracefully removes the bot from the room, stops the audio pipeline and
 * closes all WebRTC + socket connections for that room.
 */
app.post('/leave', (req: Request, res: Response) => {
  const { roomId } = req.body as { roomId?: string };

  if (!roomId) return res.status(400).json({ error: 'roomId is required' });

  const bot = bots.get(roomId);
  if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

  bot.destroy();
  bots.delete(roomId);
  console.log(`[/leave] Bot removed from room: ${roomId}`);
  return res.json({ ok: true, roomId });
});

/**
 * POST /pause
 * Body: { roomId: string }
 * Pauses frame dispatch. The yt-dlp/ffmpeg pipeline keeps running so resume is instant.
 */
app.post('/pause', (req: Request, res: Response) => {
  const { roomId } = req.body as { roomId?: string };

  if (!roomId) return res.status(400).json({ error: 'roomId is required' });

  const bot = bots.get(roomId);
  if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

  bot.pause();
  console.log(`[/pause] Paused room: ${roomId}`);
  return res.json({ ok: true, roomId });
});

/**
 * POST /resume
 * Body: { roomId: string }
 * Resumes frame dispatch after a pause.
 */
app.post('/resume', (req: Request, res: Response) => {
  const { roomId } = req.body as { roomId?: string };

  if (!roomId) return res.status(400).json({ error: 'roomId is required' });

  const bot = bots.get(roomId);
  if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

  bot.resume();
  console.log(`[/resume] Resumed room: ${roomId}`);
  return res.json({ ok: true, roomId });
});

/**
 * POST /seek
 * Body: { roomId: string, seconds: number }
 * Seeks to the given position by restarting the pipeline with an ffmpeg output-seek offset.
 */
app.post('/seek', (req: Request, res: Response) => {
  const { roomId, seconds } = req.body as { roomId?: string; seconds?: number };

  if (!roomId)              return res.status(400).json({ error: 'roomId is required' });
  if (seconds === undefined) return res.status(400).json({ error: 'seconds is required' });

  const bot = bots.get(roomId);
  if (!bot) return res.status(404).json({ error: `No bot in room "${roomId}"` });

  bot.seek(Math.max(0, seconds) * 1000);
  console.log(`[/seek] Seeked room ${roomId} to ${seconds}s`);
  return res.json({ ok: true, roomId, seconds });
});

/**
 * POST /resolve
 * Body: { url: string }
 * Resolves a YouTube URL (single video or playlist) to individual video items
 * using yt-dlp --flat-playlist. Used by the frontend to expand playlists.
 */
app.post('/resolve', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const items = await resolveUrl(url);
    return res.json({ items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/resolve] Failed for "${url}":`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /rooms
 * Returns the list of room IDs where a bot is currently active.
 */
app.get('/rooms', (_req: Request, res: Response) => {
  return res.json({ rooms: [...bots.keys()] });
});

/**
 * GET /status/:roomId
 * Returns the current playback state for a room.
 */
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
    console.log('[Boot] Authenticating bot account...');
    await login();
    startTokenRefresh();
    console.log('[Boot] Auth OK ✓');

    app.listen(config.PORT, () => {
      console.log(`[Boot] Music bot HTTP server listening on :${config.PORT}`);
      console.log(`[Boot] Endpoints:`);
      console.log(`[Boot]   POST /hub/join  |  POST /join   |  POST /play   |  POST /leave`);
      console.log(`[Boot]   POST /pause     |  POST /resume |  POST /seek   |  POST /resolve`);
      console.log(`[Boot]   GET  /rooms     |  GET  /status/:roomId`);
    });
  } catch (err) {
    console.error('[Boot] Fatal - failed to authenticate:', err);
    process.exit(1);
  }
})();

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const shutdown = () => {
  console.log('\n[Shutdown] Cleaning up all bot instances...');
  for (const [roomId, bot] of bots) {
    console.log(`[Shutdown] Destroying bot in room: ${roomId}`);
    bot.destroy();
  }
  process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
