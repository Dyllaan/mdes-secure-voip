import config from '../../config';
import { createPeerAuthMiddleware } from '../../http/peerAuthMiddleware';
import { extractPeerToken } from '../../auth/extractPeerToken';
import { signJwt } from '../helpers/signJwt';

function mockRes() {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('extractPeerToken', () => {
    it('prefers the Authorization header when present', () => {
        expect(extractPeerToken({
            headers: { authorization: 'Bearer header-token' },
            query: { token: 'query-token' },
        } as any)).toBe('header-token');
    });

    it('falls back to the token query parameter', () => {
        expect(extractPeerToken({
            headers: {},
            query: { token: 'query-token' },
        } as any)).toBe('query-token');
    });
});

describe('createPeerAuthMiddleware', () => {
    const middleware = createPeerAuthMiddleware(config.services.realtime);

    it('accepts a valid access token from the query string', () => {
        const req: any = {
            method: 'GET',
            headers: {},
            query: { token: signJwt('peer-user') },
        };
        const res = mockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects refresh tokens', () => {
        const req: any = {
            method: 'GET',
            headers: {},
            query: { token: signJwt('peer-user', { tokenUse: 'refresh', audience: 'auth-service' }) },
        };
        const res = mockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});
