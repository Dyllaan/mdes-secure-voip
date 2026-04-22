import jwt from 'jsonwebtoken';
import config from '../../config';
import { verifyAccessToken } from '../../auth/verifyAccessToken';

jest.mock('jsonwebtoken');

const mockedJwt = jwt as jest.Mocked<typeof jwt>;

describe('verifyAccessToken', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedJwt.verify.mockReturnValue({ sub: 'user-001', token_use: 'access' } as any);
    });

    it('accepts access tokens with a subject', () => {
        const decoded = verifyAccessToken('token', config.services.realtime);
        expect(decoded.sub).toBe('user-001');
        expect(mockedJwt.verify).toHaveBeenCalledWith('token', config.services.realtime.jwt.publicKey, {
            algorithms: ['RS256'],
            issuer: config.services.realtime.jwt.issuer,
            audience: config.services.realtime.jwt.accessAudience,
        });
    });

    it('rejects tokens without a string subject', () => {
        mockedJwt.verify.mockReturnValue({ sub: 123, token_use: 'access' } as any);
        expect(() => verifyAccessToken('token', config.services.realtime)).toThrow();
    });

    it('rejects refresh tokens on access-only transports', () => {
        mockedJwt.verify.mockReturnValue({ sub: 'user-001', token_use: 'refresh' } as any);
        expect(() => verifyAccessToken('token', config.services.realtime)).toThrow();
    });
});
