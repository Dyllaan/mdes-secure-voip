import type { Request } from 'express';

export function extractPeerToken(req: Pick<Request, 'headers' | 'query'>): string | null {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        return token || null;
    }

    const token = req.query.token;
    return typeof token === 'string' && token ? token : null;
}
