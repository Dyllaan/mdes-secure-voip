import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { randomUUID } from 'crypto';

import { config, logger } from './config';
import {
  authLimiter,
  generalLimiter,
  musicLimiter,
  breakers,
  circuitBreaker,
  requestId,
} from './middleware';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(pinoHttp({ logger, genReqId: (req: IncomingMessage): string => (req.headers['x-request-id'] as string) ?? randomUUID() }));
app.use(requestId);
app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

function makeProxy(target: string, opts: Partial<Options> = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 5000,
    timeout: 5000,
    ...opts,
    onError: opts.onError ?? ((err: Error, _req: Request, res: Response) => {
      logger.error({ err, target }, 'Proxy error');
      res.status(503).json({ error: 'Service unavailable' });
    }),
  });
}

app.get('/health', async (_req: Request, res: Response) => {
  const services: Record<string, string> = {
    auth:     config.AUTH_SERVICE_URL,
    realtime: config.REALTIME_SERVICE_URL,
    musicman: config.MUSICMAN_URL,
    hub:      config.HUB_SERVICE_URL,
  };

  const results = await Promise.allSettled(
    Object.entries(services).map(async ([name, url]) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const r = await fetch(`${url}/health`, { signal: controller.signal });
        return { name, status: r.ok ? 'UP' : 'DEGRADED' };
      } catch {
        return { name, status: 'DOWN' };
      } finally {
        clearTimeout(timeout);
      }
    }),
  );

  const statuses = Object.fromEntries(
    (results as PromiseFulfilledResult<{ name: string; status: string }>[]).map(
      (r) => [r.value.name, r.value.status],
    ),
  );
  const allUp = Object.values(statuses).every((s) => s === 'UP');

  res.status(allUp ? 200 : 207).json({
    status: allUp ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    services: statuses,
  });
});

app.use('/auth',
  authLimiter,
  circuitBreaker(breakers.auth, 'Auth'),
  makeProxy(config.AUTH_SERVICE_URL, {
    pathRewrite: { '^/auth': '' },
    onError: (err: Error, _req: Request, res: Response) => {
      breakers.auth.open();
      logger.error({ err }, 'Auth service error');
      res.status(503).json({ error: 'Auth service unavailable' });
    },
  }),
);

app.use('/realtime',
  generalLimiter,
  circuitBreaker(breakers.realtime, 'Realtime'),
  makeProxy(config.REALTIME_SERVICE_URL, {
    onError: (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'Realtime service error');
      res.status(503).json({ error: 'Realtime service unavailable' });
    },
  }),
);

app.use('/hub',
  generalLimiter,
  circuitBreaker(breakers.hub, 'Hub'),
  makeProxy(config.HUB_SERVICE_URL, {
    pathRewrite: { '^/hub': '/api' },
    onError: (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'Hub service error');
      res.status(503).json({ error: 'Hub service unavailable' });
    },
  }),
);

app.use('/musicman',
  musicLimiter,
  circuitBreaker(breakers.musicman, 'MusicMan'),
  makeProxy(config.MUSICMAN_URL, {
    pathRewrite: { '^/musicman': '' },
    proxyTimeout: 120_000,
    timeout: 120_000,
    onError: (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'MusicMan service error');
      res.status(503).json({ error: 'MusicMan service unavailable' });
    },
  }),
);

const socketIoProxy = makeProxy(config.REALTIME_SERVICE_URL, {
  ws: true,
  logLevel: 'silent',
  onProxyReqWs: (_proxyReq: ClientRequest, _req: IncomingMessage, socket: Socket) => {
    logger.debug('WebSocket upgrade - Socket.IO');
    socket.on('error', (err: Error) => logger.error({ err }, 'Socket.IO error'));
  },
  onError: (err: Error) => logger.error({ err }, 'Socket.IO proxy error'),
});
app.use('/socket.io', socketIoProxy);

const peerJsProxy = makeProxy(config.PEER_SERVICE_URL, {
  ws: true,
  logLevel: 'silent',
  onProxyReqWs: (_proxyReq: ClientRequest, req: IncomingMessage, socket: Socket) => {
    logger.debug({ url: req.url }, 'WebSocket upgrade - PeerJS');
    socket.on('error', (err: Error) => logger.error({ err }, 'PeerJS error'));
  },
  onError: (err: Error) => logger.error({ err }, 'PeerJS proxy error'),
});
app.use('/peerjs', peerJsProxy);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

export { app, socketIoProxy, peerJsProxy };