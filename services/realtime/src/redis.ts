import Redis from 'ioredis';

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
    if (_redis) return _redis;

    const url = process.env.REDIS_URL;
    if (!url) return null;

    _redis = new Redis(url, { lazyConnect: true, enableOfflineQueue: false });

    _redis.on('error', (err) => {
        console.error('[Redis] connection error:', err.message);
    });

    _redis.connect().catch((err) => {
        console.error('[Redis] failed to connect:', err.message);
        _redis = null;
    });

    return _redis;
}
