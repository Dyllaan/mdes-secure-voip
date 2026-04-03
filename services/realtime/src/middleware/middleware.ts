import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import express, { Application } from 'express';
import { RealtimeConfig } from '../config';

function setupMiddleware(app: Application, config: RealtimeConfig): void {
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                connectSrc: ["'self'", ...config.cors.origin]
            }
        }
    }));
    app.use(cors(config.cors));
    app.use(express.json({ limit: '10kb' }));
    app.use(rateLimit({
        windowMs: config.security.apiRateLimitWindow,
        max: config.security.apiRateLimitMax,
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false
    }));
}

export default setupMiddleware;