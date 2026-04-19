import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RealtimeConfig } from '../config';
import { verifyAccessToken } from '../auth/verifyAccessToken';
import { extractPeerToken } from '../auth/extractPeerToken';

export function createPeerAuthMiddleware(config: RealtimeConfig): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.method === 'OPTIONS') {
            next();
            return;
        }

        const token = extractPeerToken(req);
        if (!token) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        try {
            verifyAccessToken(token, config);
            next();
        } catch {
            res.status(401).json({ error: 'Invalid token' });
        }
    };
}
