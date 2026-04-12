jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(),
}));

import { randomUUID } from 'crypto';
import { circuitBreaker, requestId, authLimiter, generalLimiter, musicLimiter } from '../middleware';

function mockRes() {
  const res: any = {};
  res.status     = jest.fn().mockReturnValue(res);
  res.json       = jest.fn().mockReturnValue(res);
  res.setHeader  = jest.fn();
  return res;
}

function mockReq(requestId?: string) {
  return {
    headers: requestId ? { 'x-request-id': requestId } : {},
  } as any;
}

const mockRandomUUID = randomUUID as jest.MockedFunction<typeof randomUUID>;

describe('circuitBreaker middleware', () => {
  it('calls next() when breaker is closed', () => {
    const breaker = { opened: false } as any;
    const middleware = circuitBreaker(breaker, 'TestService');
    const res  = mockRes();
    const next = jest.fn();
    middleware(mockReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 503 when breaker is open', () => {
    const breaker = { opened: true } as any;
    const middleware = circuitBreaker(breaker, 'TestService');
    const res  = mockRes();
    const next = jest.fn();
    middleware(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('error message includes the serviceName argument', () => {
    const breaker = { opened: true } as any;
    const middleware = circuitBreaker(breaker, 'MySpecialService');
    const res  = mockRes();
    middleware(mockReq(), res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.error).toContain('MySpecialService');
  });

  it('two independent breakers behave independently in the same test', () => {
    const openBreaker   = { opened: true } as any;
    const closedBreaker = { opened: false } as any;

    const openMiddleware   = circuitBreaker(openBreaker, 'ServiceA');
    const closedMiddleware = circuitBreaker(closedBreaker, 'ServiceB');

    const resA  = mockRes();
    const nextA = jest.fn();
    openMiddleware(mockReq(), resA, nextA);
    expect(resA.status).toHaveBeenCalledWith(503);
    expect(nextA).not.toHaveBeenCalled();

    const resB  = mockRes();
    const nextB = jest.fn();
    closedMiddleware(mockReq(), resB, nextB);
    expect(resB.status).not.toHaveBeenCalled();
    expect(nextB).toHaveBeenCalledTimes(1);
  });
});

describe('requestId middleware', () => {
  const GENERATED_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    mockRandomUUID.mockReturnValue(GENERATED_UUID as any);
  });

  afterEach(() => {
    mockRandomUUID.mockReset();
  });

  it('generates a UUID and sets X-Request-ID response header when no header is present', () => {
    const req  = mockReq();
    const res  = mockRes();
    requestId(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', GENERATED_UUID);
  });

  it('attaches generated id to req.headers["x-request-id"] when no header is present', () => {
    const req  = mockReq();
    const res  = mockRes();
    requestId(req, res, jest.fn());
    expect(req.headers['x-request-id']).toBe(GENERATED_UUID);
  });

  it('echoes existing x-request-id in the X-Request-ID response header', () => {
    const existing = 'my-existing-id-123';
    const req  = mockReq(existing);
    const res  = mockRes();
    requestId(req, res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', existing);
  });

  it('does not overwrite req.headers["x-request-id"] when already present', () => {
    const existing = 'my-existing-id-123';
    const req  = mockReq(existing);
    const res  = mockRes();
    requestId(req, res, jest.fn());
    expect(req.headers['x-request-id']).toBe(existing);
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });

  it('always calls next()', () => {
    const next1 = jest.fn();
    const next2 = jest.fn();
    requestId(mockReq(), mockRes(), next1);
    requestId(mockReq('some-id'), mockRes(), next2);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it('two requests without a header each get a unique UUID', () => {
    let counter = 0;
    mockRandomUUID.mockImplementation(() => `uuid-${++counter}` as any);

    const req1 = mockReq();
    const req2 = mockReq();
    requestId(req1, mockRes(), jest.fn());
    requestId(req2, mockRes(), jest.fn());

    expect(req1.headers['x-request-id']).toBe('uuid-1');
    expect(req2.headers['x-request-id']).toBe('uuid-2');
  });
});

describe('rate limiters - structural', () => {
  it('authLimiter, generalLimiter, musicLimiter are defined', () => {
    expect(authLimiter).toBeDefined();
    expect(generalLimiter).toBeDefined();
    expect(musicLimiter).toBeDefined();
  });
});
