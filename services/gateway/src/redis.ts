import { createClient } from 'redis';
import { config } from './config/config';

/**
 * Removable if you dont want demo rate limiting. Used by demoLimiter middleware to track usage time for each user in Redis.
 */
export const redis = createClient({ url: config.REDIS_URL });

redis.on('error', (err) => console.error({ err }, 'Redis error'));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}