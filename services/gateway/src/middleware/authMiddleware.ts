import { Buffer } from 'buffer';
import { type Request, type Response, type NextFunction } from 'express';
import { createVerifier } from 'fast-jwt';
import { config } from '../config/config';

export const verify = createVerifier({
  key: Buffer.from(config.JWT_SECRET, 'base64'),
  algorithms: ['HS256'],
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!token) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = verify(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}