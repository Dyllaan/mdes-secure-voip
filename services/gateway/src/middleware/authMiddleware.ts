import { Buffer } from 'buffer';
import { type Request, type Response, type NextFunction } from 'express';
import { createVerifier } from 'fast-jwt';
import { config } from '../config/config';

export const verify = createVerifier({
  key: Buffer.from(config.JWT_PUBLIC_KEY_B64, 'base64').toString('utf8'),
  algorithms: ['RS256'],
  allowedIss: config.JWT_ISSUER,
  allowedAud: config.JWT_ACCESS_AUDIENCE,
});

export function verifyAccessToken(token: string) {
  const decoded = verify(token) as Record<string, unknown>;
  if (typeof decoded.sub !== 'string' || decoded.token_use !== 'access') {
    throw new Error('Invalid token');
  }
  return decoded as { sub: string; [key: string]: unknown };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
