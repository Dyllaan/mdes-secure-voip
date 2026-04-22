import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { login, startTokenRefresh, fetchTurnCredentials } from './Auth';
import { MusicSession } from './music/MusicSession';
import { config } from './config';
import { createRouter } from './http/Routes';
import { createLogger, formatErrorForLog } from './logging';

export const app = express();
const sessions = new Map<string, MusicSession>();
const bootLog = createLogger('boot');
const processLog = createLogger('process');

function bootConfigSummary() {
    return {
        port: config.PORT,
        signalingUrl: config.SIGNALING_URL,
        authUrl: config.AUTH_URL,
        gatewayUrl: config.GATEWAY_URL,
        hubServiceUrl: config.HUB_SERVICE_URL,
        peerHost: config.PEER_HOST,
        peerPort: config.PEER_PORT,
        peerPath: config.PEER_PATH,
        peerSecure: config.PEER_SECURE,
        botUsername: config.BOT_USERNAME,
        botPasswordPresent: Boolean(process.env.BOT_PASSWORD),
        botSecretPresent: Boolean(process.env.BOT_SECRET),
        jwtPublicKeyPresent: Boolean(process.env.JWT_PUBLIC_KEY_B64),
        turnHost: config.TURN_HOST,
        turnPort: config.TURN_PORT,
        turnSecure: config.TURN_SECURE,
        allowedAudioOrigins: config.ALLOWED_AUDIO_ORIGINS ?? '(default)',
        allowedVideoOrigins: config.ALLOWED_VIDEO_ORIGINS ?? '(default)',
        nodeEnv: process.env.NODE_ENV ?? 'development',
        pid: process.pid,
    };
}

app.use(express.json({ limit: '64kb' }));
app.use(createRouter(sessions));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    processLog.error('http.unhandled_error', { error: formatErrorForLog(err) });
    res.status(500).json({ error: err.message });
});

(async () => {
    try {
        bootLog.info('bootstrap.start', { ...bootConfigSummary(), debugEnabled: config.DEBUG });
        bootLog.info('bootstrap.stage.start', { stage: 'login' });
        await login();
        bootLog.info('bootstrap.stage.complete', { stage: 'login' });
        bootLog.info('bootstrap.stage.start', { stage: 'fetchTurnCredentials' });
        await fetchTurnCredentials();
        bootLog.info('bootstrap.stage.complete', { stage: 'fetchTurnCredentials' });
        bootLog.info('bootstrap.stage.start', { stage: 'startTokenRefresh' });
        startTokenRefresh();
        bootLog.info('bootstrap.stage.complete', { stage: 'startTokenRefresh' });
        bootLog.info('bootstrap.stage.start', { stage: 'listen', port: config.PORT });
        const server = app.listen(config.PORT, () => {
            bootLog.info('bootstrap.listen.ready', {
                port: config.PORT,
                activeRoomIds: [...sessions.keys()],
            });
        });
        server.on('error', (error) => {
            bootLog.error('bootstrap.listen.error', {
                error: formatErrorForLog(error),
            });
        });
    } catch (err) {
        bootLog.error('bootstrap.fatal', {
            error: formatErrorForLog(err),
            activeRoomIds: [...sessions.keys()],
        });
        process.exit(1);
    }
})();

let shuttingDown = false;

const shutdown = (reason: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const activeRoomIds = [...sessions.keys()];
    processLog.info('shutdown.start', { reason, exitCode, activeRoomIds });
    for (const [, session] of sessions) session.destroy(reason);
    process.exit(exitCode);
};

process.on('SIGINT',  () => shutdown('sigint', 0));
process.on('SIGTERM', () => shutdown('sigterm', 0));
process.on('uncaughtException', (error) => {
    processLog.error('uncaught_exception', {
        error: formatErrorForLog(error),
        activeRoomIds: [...sessions.keys()],
    });
    shutdown('uncaught_exception', 1);
});
process.on('unhandledRejection', (reason) => {
    processLog.error('unhandled_rejection', {
        error: formatErrorForLog(reason),
        activeRoomIds: [...sessions.keys()],
    });
    shutdown('unhandled_rejection', 1);
});
