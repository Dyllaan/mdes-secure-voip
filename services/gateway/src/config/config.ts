/**
 * Ensures all required environment variables are set and exported
 */

const { createPublicKey } = require('crypto');
const pino = require('pino');
require('dotenv').config();

const REQUIRED = [
  'CORS_ORIGIN',
  'AUTH_SERVICE_URL',
  'REALTIME_SERVICE_URL',
  'PEER_SERVICE_URL',
  'HUB_SERVICE_URL',
  'MUSICMAN_URL',
  'TURN_SECRET',
  'JWT_PUBLIC_KEY_B64',
];

const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

function decodeAndValidatePublicKey(raw: string): string {
  const pem = Buffer.from(raw, 'base64').toString('utf8');
  try {
    createPublicKey(pem);
    return pem;
  } catch {
    throw new Error('Invalid JWT_PUBLIC_KEY_B64');
  }
}

const jwtPublicKey = decodeAndValidatePublicKey(process.env.JWT_PUBLIC_KEY_B64 as string);

const config = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: process.env.PORT ?? 3000,
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  CORS_ORIGIN: process.env.CORS_ORIGIN as string,
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL as string,
  REALTIME_SERVICE_URL: process.env.REALTIME_SERVICE_URL as string,
  PEER_SERVICE_URL: process.env.PEER_SERVICE_URL as string,
  HUB_SERVICE_URL: process.env.HUB_SERVICE_URL as string,
  MUSICMAN_URL: process.env.MUSICMAN_URL as string,
  TURN_SECRET: process.env.TURN_SECRET as string,
  BOT_SECRET: process.env.BOT_SECRET ?? '',
  BOT_USERNAME: (process.env.BOT_USERNAME ?? 'musicman').trim().toLowerCase(),
  JWT_PUBLIC_KEY_B64: Buffer.from(jwtPublicKey).toString('base64'),
  JWT_ISSUER: process.env.JWT_ISSUER ?? 'mdes-secure-voip-auth',
  JWT_ACCESS_AUDIENCE: process.env.JWT_ACCESS_AUDIENCE ?? 'voip-services',
  MAX_REQUEST_BODY_BYTES: parseInt(process.env.MAX_REQUEST_BODY_BYTES ?? '1048576', 10),
};

const logger = pino({ level: config.LOG_LEVEL });

export { config, logger };
