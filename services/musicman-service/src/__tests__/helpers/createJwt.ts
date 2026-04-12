import { createHmac } from 'crypto';

/** Build a real HS256 JWT signed with the test secret ('test-secret' base64-encoded). */
export function createTestJwt(payload: Record<string, unknown> = {}, secretOverride?: string): string {
  const secret = secretOverride ?? 'test-secret';
  const secretBuf = Buffer.from(Buffer.from(secret).toString('base64'), 'base64');

  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({
    sub: 'user-123',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...payload,
  })).toString('base64url');

  const signingInput = `${header}.${body}`;
  const sig = createHmac('sha256', secretBuf).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}
