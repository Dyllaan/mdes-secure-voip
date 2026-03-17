import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './config';
import { login, startTokenRefresh, getToken } from './auth';
import { BotInstance } from './BotInstance';
import { HubHandler } from './HubHandler';

const app  = express();
const bots = new Map<string, BotInstance>();

app.use(express.json());

/**
 * POST /join
 *
 * Body: { roomId: string, youtubeUrl: string }
 *
 * Spawns a bot instance that joins the given Talk room and streams audio from
 * the supplied YouTube URL. Safe to call for multiple rooms simultaneously.
 */
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
 * POST /leave
 *
 * Body: { roomId: string }
 *
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
      console.log(`[Boot] Endpoints: POST /hub/join  |  POST /join  |  POST /leave  |  GET /rooms`);
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
