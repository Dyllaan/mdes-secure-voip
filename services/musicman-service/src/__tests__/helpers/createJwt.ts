import { createSign, generateKeyPairSync } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PRIVATE_KEY = readFileSync(resolve(__dirname, '../../../../../test-fixtures/jwt/private.pem'), 'utf8');

type JwtOptions = {
  privateKey?: string;
};

/** Build a real RS256 JWT signed with the shared test private key. */
export function createTestJwt(payload: Record<string, unknown> = {}, options: JwtOptions = {}): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({
    sub: 'user-123',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    iss: 'mdes-secure-voip-auth',
    aud: 'voip-services',
    token_use: 'access',
    ...payload,
  })).toString('base64url');

  const signingInput = `${header}.${body}`;
  const sig = createSign('RSA-SHA256').update(signingInput).end().sign(options.privateKey ?? PRIVATE_KEY).toString('base64url');
  return `${signingInput}.${sig}`;
}

export function createRefreshJwt(payload: Record<string, unknown> = {}): string {
  return createTestJwt({ token_use: 'refresh', aud: 'auth-service', ...payload });
}

export function createWrongKeyJwt(payload: Record<string, unknown> = {}): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return createTestJwt(payload, {
    privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  });
}
