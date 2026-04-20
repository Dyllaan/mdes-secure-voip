import express, { NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createProxyMiddleware, fixRequestBody, type Options } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { randomUUID } from 'crypto';

import { config, logger } from './config/config';
import {
  authLimiter,
  generalLimiter,
  musicLimiter,
  breakers,
  circuitBreaker,
  requestId,
  authSlowLimiter,
} from './middleware/middleware';
import { turnCredentials } from './config/turnCredentials';
import { requireAuth } from './middleware/authMiddleware';
import { requirePeerAuth } from './middleware/peerAuth';
/**
 * Gateway service that proxies requests to the appropriate backend services, handles authentication, and provides a unified API for the frontend. It also includes health checks and rate limiting to ensure reliability and security.
 */
const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(pinoHttp({ logger, genReqId: (req: IncomingMessage): string => (req.headers['x-request-id'] as string) ?? randomUUID() }));
app.use(requestId);
app.use(cors({
  origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));
app.use(express.json({ limit: config.MAX_REQUEST_BODY_BYTES }));


function makeProxy(target: string, opts: Partial<Options> = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 5000,
    timeout: 5000,
    ...opts,
    onProxyReq: (proxyReq, req) => {
      const body = (req as Request).body;
      if (body && Object.keys(body).length > 0) {
        const serialised = JSON.stringify(body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(serialised));
        proxyReq.write(serialised);
      }
    },
    onError: opts.onError ?? ((err: Error, _req: Request, res: Response) => {
      logger.error({ err, target }, 'Proxy error');
      res.status(503).json({ error: 'Service unavailable' });
    }),
  });
}

function forwardSetCookieHeader(upstream: { headers?: { getSetCookie?: () => string[]; get?: (name: string) => string | null } }, res: Response) {
  const setCookies = upstream.headers?.getSetCookie?.()
    ?? (upstream.headers?.get?.('set-cookie') ? [upstream.headers.get('set-cookie')!] : []);
  if (setCookies.length > 0) {
    res.setHeader('Set-Cookie', setCookies);
  }
}

app.get('/health', generalLimiter, async (_req: Request, res: Response) => {
  const services: Record<string, string> = {
    auth:     `${config.AUTH_SERVICE_URL}/actuator/health`,
    realtime: `${config.REALTIME_SERVICE_URL}/health`,
    musicman: `${config.MUSICMAN_URL}/health`,
    hub:      `${config.HUB_SERVICE_URL}/health`,
  };

  const results = await Promise.allSettled(
    Object.entries(services).map(async ([name, url]) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const r = await fetch(url, { signal: controller.signal });
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

app.post('/auth/user/login',
  authSlowLimiter,
  authLimiter,
  async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    if (username.length > 64 || password.length > 128) {
      return res.status(400).json({ error: 'Field length exceeded' });
    }

    try {
      const upstream = await fetch(`${config.AUTH_SERVICE_URL}/user/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
        },
        body: JSON.stringify(req.body),
      });

      const text = await upstream.text();
      const body = text ? JSON.parse(text) : {};
      forwardSetCookieHeader(upstream as any, res);

      return res.status(upstream.status).json(body);
    } catch (err) {
      logger.error({ err }, 'Login proxy error');
      return res.status(503).json({ error: 'Auth service unavailable' });
    }
  },
);

app.post('/auth/user/logout',
  requireAuth,
  authLimiter,
  async (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
);

app.post('/auth/user/register', authSlowLimiter, authLimiter);

app.post('/auth/user/register',
  authSlowLimiter,
  authLimiter,
  circuitBreaker(breakers.auth, 'Auth'),
  makeProxy(config.AUTH_SERVICE_URL, {
    pathRewrite: { '^/auth': '' },
    onError: (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'Auth service error');
      res.status(503).json({ error: 'Auth service unavailable' });
    },
  }),
);

app.use('/auth',
  authSlowLimiter,
  authLimiter,
  circuitBreaker(breakers.auth, 'Auth'),
  makeProxy(config.AUTH_SERVICE_URL, {
    pathRewrite: { '^/auth': '' },
    onError: /* istanbul ignore next */ (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'Auth service error');
      res.status(503).json({ error: 'Auth service unavailable' });
    },
  }),
);

app.use('/realtime',
  generalLimiter,
  circuitBreaker(breakers.realtime, 'Realtime'),
  requireAuth,
  makeProxy(config.REALTIME_SERVICE_URL, {
    onError: /* istanbul ignore next */ (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'Realtime service error');
      res.status(503).json({ error: 'Realtime service unavailable' });
    },
  }),
);

app.use('/hub',
  generalLimiter,
  circuitBreaker(breakers.hub, 'Hub'),
  requireAuth,
  makeProxy(config.HUB_SERVICE_URL, {
    pathRewrite: { '^/hub': '/api' },
    onError: /* istanbul ignore next */ (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'Hub service error');
      res.status(503).json({ error: 'Hub service unavailable' });
    },
  }),
);

app.use('/musicman',
  musicLimiter,
  circuitBreaker(breakers.musicman, 'MusicMan'),
  requireAuth,
  makeProxy(config.MUSICMAN_URL, {
    pathRewrite: { '^/musicman': '' },
    proxyTimeout: 120_000,
    timeout: 120_000,
    onError: /* istanbul ignore next */ (err: Error, _req: Request, res: Response) => {
      logger.error({ err }, 'MusicMan service error');
      res.status(503).json({ error: 'MusicMan service unavailable' });
    },
  }),
);

const socketIoProxy = makeProxy(config.REALTIME_SERVICE_URL, {
  ws: true,
  logLevel: 'silent',
  onProxyReqWs: /* istanbul ignore next */ (_proxyReq: ClientRequest, _req: IncomingMessage, socket: Socket) => {
    logger.debug('WebSocket upgrade - Socket.IO');
    socket.on('error', (err: Error) => logger.error({ err }, 'Socket.IO error'));
  },
  onError: /* istanbul ignore next */ (err: Error) => logger.error({ err }, 'Socket.IO proxy error'),
});
app.use('/socket.io', socketIoProxy);

const peerJsProxy = makeProxy(config.PEER_SERVICE_URL, {
  ws: true,
  logLevel: 'silent',
  onProxyReqWs: /* istanbul ignore next */ (_proxyReq: ClientRequest, req: IncomingMessage, socket: Socket) => {
    logger.debug({ url: req.url }, 'WebSocket upgrade - PeerJS');
    socket.on('error', (err: Error) => logger.error({ err }, 'PeerJS error'));
  },
  onError: /* istanbul ignore next */ (err: Error) => logger.error({ err }, 'PeerJS proxy error'),
});
app.use('/peerjs', requirePeerAuth, peerJsProxy);

app.get('/turn-credentials', generalLimiter, requireAuth, turnCredentials);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

export { app, socketIoProxy, peerJsProxy };
