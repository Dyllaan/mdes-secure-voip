/**
 * Ensures the demo at Mdes.sh is not used indefinitely.
 */

import { type Request, type Response, type NextFunction } from 'express';
import { redis } from '../redis';
import { config, logger } from '../config/config';

const DEMO_LIMIT_SECONDS = config.DEMO_TIME_LIMIT_SECONDS;

function keys(uid: string) {
  return {
    used: `demo:${uid}:used`,
    start: `demo:${uid}:start`,
  };
}

export async function onLogin(uid: string): Promise<void> {
  const k = keys(uid);
  const nowSec = Math.floor(Date.now() / 1000);
  await redis.set(k.start, nowSec);
  await redis.setnx(k.used, 0); // only initialises if absent
}

export async function onLogout(uid: string): Promise<void> {
  const k = keys(uid);
  const startRaw = await redis.get(k.start);
  if (!startRaw) return;

  const delta = Math.floor(Date.now() / 1000) - parseInt(startRaw, 10);
  await redis.incrBy(k.used, delta);
  await redis.del(k.start);
}

export async function demoGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!process.env.DEMO_MODE) return next();

  const uid: string = (req.user as any).sub;
  const k = keys(uid);

  const [usedRaw, startRaw] = await Promise.all([
    redis.get(k.used),
    redis.get(k.start),
  ]);

  const used = parseInt(usedRaw ?? '0', 10);
  const delta = startRaw
    ? Math.floor(Date.now() / 1000) - parseInt(startRaw, 10)
    : 0;

  if (used + delta >= DEMO_LIMIT_SECONDS) {
    logger.info({ uid, used, delta }, 'Demo limit reached for user');
    res.status(403).json({ error: 'Demo limit reached', code: 'DEMO_EXPIRED' });
    return;
  }

  next();
}