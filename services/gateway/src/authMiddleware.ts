import { Buffer } from 'buffer';
import { type Request, type Response, type NextFunction } from 'express';
import { createVerifier } from 'fast-jwt';
import { config } from './config';

const verify = createVerifier({
  key: Buffer.from(config.JWT_SECRET, 'base64'),
  algorithms: ['HS256'],
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = verify(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}