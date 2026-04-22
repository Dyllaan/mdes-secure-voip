import type { NextFunction, Request, Response } from 'express';
import type http from 'http';
import { extractRequestToken, extractUpgradeToken } from '../config/upgradeToken';
import { verifyAccessToken } from './authMiddleware';

function isOptionsRequest(req: Pick<Request, 'method'>): boolean {
  return req.method === 'OPTIONS';
}

export function requirePeerAuth(req: Request, res: Response, next: NextFunction) {
  if (isOptionsRequest(req)) {
    next();
    return;
  }

  const token = extractRequestToken(req.originalUrl || req.url, req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function isAuthorisedPeerUpgrade(req: http.IncomingMessage): boolean {
  const token = extractUpgradeToken(req);
  if (!token) {
    return false;
  }

  try {
    verifyAccessToken(token);
    return true;
  } catch {
    return false;
  }
}
