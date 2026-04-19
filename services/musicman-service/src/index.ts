import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { register, login, startTokenRefresh, fetchTurnCredentials } from './Auth';
import { BotInstance } from './instances/BotInstance';
import { config } from './config';
import { createRouter } from './http/Routes';
import { formatErrorForLog } from './logging';

export const app = express();
const bots = new Map<string, BotInstance>();

app.use(express.json({ limit: '4kb' }));
app.use(createRouter(bots));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Unhandled]', err);
    res.status(500).json({ error: err.message });
});

(async () => {
    try {
        await register();
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

let shuttingDown = false;

const shutdown = (reason: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const activeRoomIds = [...bots.keys()];
    console.log('[Shutdown] Starting', { reason, exitCode, activeRoomIds });
    for (const [, bot] of bots) bot.destroy(reason);
    process.exit(exitCode);
};

process.on('SIGINT',  () => shutdown('sigint', 0));
process.on('SIGTERM', () => shutdown('sigterm', 0));
process.on('uncaughtException', (error) => {
    console.error('[Process] uncaughtException', {
        error: formatErrorForLog(error),
        activeRoomIds: [...bots.keys()],
    });
    shutdown('uncaught_exception', 1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Process] unhandledRejection', {
        error: formatErrorForLog(reason),
        activeRoomIds: [...bots.keys()],
    });
    shutdown('unhandled_rejection', 1);
});
