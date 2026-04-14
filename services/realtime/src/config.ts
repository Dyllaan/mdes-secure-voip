import 'dotenv/config';
import type { CorsOptions } from 'cors';

const REQUIRED = ['JWT_SECRET', 'ALLOWED_ORIGINS', 'HUB_SERVICE_URL'] as const;
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

// After the missing check, these are guaranteed to be defined
const env = process.env as typeof process.env & {
    JWT_SECRET: string;
    ALLOWED_ORIGINS: string;
    HUB_SERVICE_URL: string;
};

const config = {
    services: {
        realtime: {
            NODE_ENV: env.NODE_ENV ?? 'development',
            port: env.REALTIME_PORT ? parseInt(env.REALTIME_PORT) : 3001,
            peerPort: env.PEER_PORT ? parseInt(env.PEER_PORT) : 9000,
            hubServiceUrl: env.HUB_SERVICE_URL,
            sslKeyPath: env.SSL_KEY_PATH,
            sslCertPath: env.SSL_CERT_PATH,
            cors: {
                origin: env.ALLOWED_ORIGINS.split(','),
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization'],
                credentials: true,
            } satisfies CorsOptions,
            jwt: {
                secret: env.JWT_SECRET,
                expiresIn: env.JWT_EXPIRES_IN ?? '24h',
            },
            security: {
                maxAliasLength: 50,
                maxRoomIdLength: 60,
                socketRateLimitWindow: 60000,
                socketRateLimitMax: 100,
                apiRateLimitWindow: 15 * 60 * 1000,
                apiRateLimitMax: 1000,
            },
        },
    },
} as const;

export type RealtimeConfig = typeof config.services.realtime;
export default config;