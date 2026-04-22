import 'dotenv/config';
import type { CorsOptions } from 'cors';
import { createPublicKey } from 'crypto';

const REQUIRED = ['JWT_PUBLIC_KEY_B64', 'ALLOWED_ORIGINS', 'HUB_SERVICE_URL'] as const;
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const env = process.env as typeof process.env & {
    JWT_PUBLIC_KEY_B64: string;
    ALLOWED_ORIGINS: string;
    HUB_SERVICE_URL: string;
};

const int = (val: string | undefined, fallback: number) =>
    val ? parseInt(val, 10) : fallback;

function decodeAndValidatePublicKey(raw: string): string {
    const pem = Buffer.from(raw, 'base64').toString('utf8');
    try {
        createPublicKey(pem);
        return pem;
    } catch {
        throw new Error('Invalid JWT_PUBLIC_KEY_B64');
    }
}

const config = {
    services: {
        realtime: {
            NODE_ENV: env.NODE_ENV ?? 'development',
            port: int(env.REALTIME_PORT, 3001),
            peerPort: int(env.PEER_PORT, 9000),
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
                publicKey: decodeAndValidatePublicKey(env.JWT_PUBLIC_KEY_B64),
                issuer: env.JWT_ISSUER ?? 'mdes-secure-voip-auth',
                accessAudience: env.JWT_ACCESS_AUDIENCE ?? 'voip-services',
                expiresIn: env.JWT_EXPIRES_IN ?? '24h',
            },
            security: {
                maxAliasLength:          int(env.MAX_ALIAS_LENGTH, 50),
                maxRoomIdLength:         int(env.MAX_ROOM_ID_LENGTH, 60),
                maxUsernameLength:       int(env.MAX_USERNAME_LENGTH, 100),
                maxChatCiphertext:       int(env.MAX_CHAT_CIPHERTEXT, 65536),
                maxChatIv:               int(env.MAX_CHAT_IV, 512),
                maxChatKeyId:            int(env.MAX_CHAT_KEY_ID, 256),
                maxRsaKeySize:           int(env.MAX_RSA_KEY_SIZE, 4096),
                maxEncryptedKeySize:     int(env.MAX_ENCRYPTED_KEY_SIZE, 8192),
                maxChannelMessageLength: int(env.MAX_CHANNEL_MESSAGE_LENGTH, 4000),
                maxChannelNameLength:    int(env.MAX_CHANNEL_NAME_LENGTH, 25),
                maxMusicmanTitle:        int(env.MAX_MUSICMAN_TITLE, 500),
                maxMusicmanUrl:          int(env.MAX_MUSICMAN_URL, 2048),
                maxMusicmanState:        int(env.MAX_MUSICMAN_STATE, 50),
                socketRateLimitWindow:   int(env.SOCKET_RATE_LIMIT_WINDOW, 60000),
                socketRateLimitMax:      int(env.SOCKET_RATE_LIMIT_MAX, 100),
                apiRateLimitWindow:      int(env.API_RATE_LIMIT_WINDOW, 15 * 60 * 1000),
                apiRateLimitMax:         int(env.API_RATE_LIMIT_MAX, 1000),
            },
        },
    },
} as const;

export type RealtimeConfig = typeof config.services.realtime;
export default config;
