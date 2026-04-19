import jwt from 'jsonwebtoken';
import { RealtimeConfig } from '../config';

export function verifyAccessToken(token: string, config: RealtimeConfig): jwt.JwtPayload {
    const decoded = jwt.verify(token, config.jwt.publicKey, {
        algorithms: ['RS256'],
        issuer: config.jwt.issuer,
        audience: config.jwt.accessAudience,
    }) as jwt.JwtPayload;

    if (typeof decoded.sub !== 'string' || decoded.token_use !== 'access') {
        throw new jwt.JsonWebTokenError('Invalid token');
    }

    return decoded;
}
