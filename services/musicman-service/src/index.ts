import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { register, login, startTokenRefresh, fetchTurnCredentials } from './Auth';
import { BotInstance } from './instances/BotInstance';
import { config } from './config';
import { createRouter } from './http/Routes';

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

const shutdown = () => {
    for (const [, bot] of bots) bot.destroy();
    process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);