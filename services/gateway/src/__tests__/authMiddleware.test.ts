import { requireAuth } from '../middleware/authMiddleware';
import { makeJwt, makeExpiredJwt, makeMalformedToken, makeJwtSignedWithWrongKey } from './helpers/makeJwt';

function mockReq(authorization?: string) {
  return { headers: { authorization } } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireAuth - missing or malformed header', () => {
  it('returns 401 when Authorization header is absent', () => {
    const req  = mockReq(undefined);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorised' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header is "Bearer" with no token', () => {
    const req  = mockReq('Bearer');
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorised' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header is "Bearer " with empty token', () => {
    const req  = mockReq('Bearer ');
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorised' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 Unauthorised when a non-Bearer scheme is used', () => {
    const req  = mockReq('Basic dXNlcjpwYXNz');
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorised' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 Unauthorised when scheme is not Bearer regardless of token value', () => {
    const req  = mockReq(`Token ${makeJwt('user-1')}`);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorised' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireAuth - invalid tokens', () => {
  it('returns 401 with "Invalid token" for an expired token', () => {
    const req  = mockReq(`Bearer ${makeExpiredJwt('user-1')}`);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a token signed with the wrong secret', () => {
    const token   = makeJwtSignedWithWrongKey('hacker');
    const req     = mockReq(`Bearer ${token}`);
    const res     = mockRes();
    const next    = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a completely malformed string', () => {
    const req  = mockReq(`Bearer ${makeMalformedToken()}`);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a token with a tampered payload segment', () => {
    const valid    = makeJwt('user-tamper');
    const parts    = valid.split('.');
    const tampered = `${parts[0]}.dGFtcGVyZWQ.${parts[2]}`;
    const req      = mockReq(`Bearer ${tampered}`);
    const res      = mockRes();
    const next     = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a refresh token presented to an access-only route', () => {
    const req  = mockReq(`Bearer ${makeJwt('user-refresh', { tokenUse: 'refresh', audience: 'auth-service' })}`);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireAuth - valid token', () => {
  it('calls next() and sets req.user when token is valid', () => {
    const sub  = 'user-abc-123';
    const req  = mockReq(`Bearer ${makeJwt(sub)}`);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user.sub).toBe(sub);
  });

  it('attaches the full decoded payload to req.user, not just sub', () => {
    const sub  = 'user-full-payload';
    const req  = mockReq(`Bearer ${makeJwt(sub)}`);
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(req.user).toMatchObject({ sub, iat: expect.any(Number), exp: expect.any(Number) });
  });
});
