import { createHmac } from 'crypto';

// Signing key matches the base64-decoded JWT_SECRET set in setup.ts
const SECRET = 'test-jwt-secret';

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sign(header: object, payload: object): string {
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(`${h}.${p}`).digest();
  return `${h}.${p}.${base64url(sig)}`;
}

/**
 * Returns a valid HS256 JWT with the given subject, expiring in `expiresInSecs` seconds.
 */
export function makeJwt(sub: string, expiresInSecs = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { alg: 'HS256', typ: 'JWT' },
    { sub, iat: now, exp: now + expiresInSecs },
  );
}

/**
 * Returns an HS256 JWT whose `exp` is 1 second in the past.
 */
export function makeExpiredJwt(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { alg: 'HS256', typ: 'JWT' },
    { sub, iat: now - 7200, exp: now - 1 },
  );
}

/**
 * Returns a string that is not a parseable JWT.
 */
export function makeMalformedToken(): string {
  return 'not.a.token';
}
