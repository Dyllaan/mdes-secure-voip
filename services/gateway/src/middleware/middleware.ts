import rateLimit from 'express-rate-limit';
import CircuitBreaker from 'opossum';
import { randomUUID } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../config/config';

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = (req.body?.username ?? req.body?.email ?? 'unknown').toLowerCase();
    return `${req.ip}:${username}`;
  },
});

export const authSlowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = (req.body?.username ?? req.body?.email ?? 'unknown').toLowerCase();
    return `${req.ip}:${username}`;
  },
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

export const musicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function makeBreaker(name: string) {
  const breaker = new CircuitBreaker(async () => {}, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
  });
  breaker.on('open', /* istanbul ignore next */ () => logger.warn({ service: name }, 'Circuit breaker opened'));
  breaker.on('halfOpen', /* istanbul ignore next */ () => logger.info({ service: name }, 'Circuit breaker half-open, testing...'));
  breaker.on('close', /* istanbul ignore next */ () => logger.info({ service: name }, 'Circuit breaker closed'));
  return breaker;
}

export const breakers = {
  auth: makeBreaker('auth'),
  realtime: makeBreaker('realtime'),
  musicman: makeBreaker('musicman'),
  hub: makeBreaker('hub'),
};

export function circuitBreaker(breaker: typeof breakers.auth, serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (breaker.opened) {
      logger.warn({ service: serviceName }, 'Circuit breaker is open, rejecting request');
      return res.status(503).json({ error: `${serviceName} is currently unavailable, try again shortly` });
    }
    next();
  };
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-ID', id);
  next();
}