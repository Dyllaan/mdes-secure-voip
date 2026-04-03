/**
 * Ensures all required environment variables are set and exported
 */

const pino = require('pino');
require('dotenv').config();

const REQUIRED = [
  'CORS_ORIGIN',
  'AUTH_SERVICE_URL',
  'REALTIME_SERVICE_URL',
  'PEER_SERVICE_URL',
  'HUB_SERVICE_URL',
  'MUSICMAN_URL',
];

const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

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
};

const logger = pino({ level: config.LOG_LEVEL });

export { config, logger };