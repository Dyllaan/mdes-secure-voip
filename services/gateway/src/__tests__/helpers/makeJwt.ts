import { createSign, generateKeyPairSync } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PRIVATE_KEY = readFileSync(resolve(__dirname, '../../../../../test-fixtures/jwt/private.pem'), 'utf8');

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sign(header: object, payload: object, privateKey = PRIVATE_KEY): string {
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const sig = createSign('RSA-SHA256').update(`${h}.${p}`).end().sign(privateKey);
  return `${h}.${p}.${base64url(sig)}`;
}

type JwtOptions = {
  expiresInSecs?: number;
  tokenUse?: string;
  issuer?: string;
  audience?: string | string[];
  privateKey?: string;
};

export function makeJwt(sub: string, options: JwtOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const {
    expiresInSecs = 3600,
    tokenUse = 'access',
    issuer = 'mdes-secure-voip-auth',
    audience = 'voip-services',
    privateKey = PRIVATE_KEY,
  } = options;
  return sign(
    { alg: 'RS256', typ: 'JWT' },
    { sub, iat: now, exp: now + expiresInSecs, iss: issuer, aud: audience, token_use: tokenUse },
    privateKey,
  );
}

export function makeExpiredJwt(sub: string): string {
  return makeJwt(sub, { expiresInSecs: -1 });
}

export function makeMalformedToken(): string {
  return 'not.a.token';
}

export function makeJwtSignedWithWrongKey(sub: string): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return makeJwt(sub, { privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() });
}
