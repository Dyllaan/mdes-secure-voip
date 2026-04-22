import { isAuthorisedPeerUpgrade, requirePeerAuth } from '../middleware/peerAuth';
import { makeJwt } from './helpers/makeJwt';

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requirePeerAuth', () => {
  it('accepts a valid query token', () => {
    const req: any = {
      method: 'GET',
      url: '/peerjs/peerjs?token=' + makeJwt('peer-user'),
      originalUrl: '/peerjs/peerjs?token=' + makeJwt('peer-user'),
      headers: {},
    };
    const res = mockRes();
    const next = jest.fn();

    requirePeerAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.sub).toBe('peer-user');
  });

  it('rejects missing tokens', () => {
    const req: any = { method: 'GET', url: '/peerjs/peerjs', originalUrl: '/peerjs/peerjs', headers: {} };
    const res = mockRes();
    const next = jest.fn();

    requirePeerAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('isAuthorisedPeerUpgrade', () => {
  it('returns true for a valid upgrade token in the query string', () => {
    const req: any = { url: `/peerjs/peerjs?token=${makeJwt('upgrade-user')}`, headers: {} };
    expect(isAuthorisedPeerUpgrade(req)).toBe(true);
  });

  it('returns false for a refresh token in the query string', () => {
    const req: any = {
      url: `/peerjs/peerjs?token=${makeJwt('upgrade-user', { tokenUse: 'refresh', audience: 'auth-service' })}`,
      headers: {},
    };
    expect(isAuthorisedPeerUpgrade(req)).toBe(false);
  });
});
