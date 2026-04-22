import { readFileSync } from 'fs';
import { resolve } from 'path';
import jwt from 'jsonwebtoken';

const privateKey = readFileSync(resolve(__dirname, '../../../../../test-fixtures/jwt/private.pem'), 'utf8');

type SignJwtOptions = {
    audience?: string;
    issuer?: string;
    tokenUse?: string;
    expiresIn?: number;
};

export function signJwt(sub: string, options: SignJwtOptions = {}): string {
    const {
        audience = configAudience,
        issuer = 'mdes-secure-voip-auth',
        tokenUse = 'access',
        expiresIn = 3600,
    } = options;

    return jwt.sign(
        { token_use: tokenUse },
        privateKey,
        {
            algorithm: 'RS256',
            subject: sub,
            issuer,
            audience,
            expiresIn,
            jwtid: `${sub}-${tokenUse}`,
        },
    );
}

const configAudience = 'voip-services';
