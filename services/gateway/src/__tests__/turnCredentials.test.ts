jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn(),
}));

import { createHmac } from 'crypto';
import { randomBytes } from 'crypto';
import { turnCredentials } from '../turnCredentials';

const mockRandomBytes = randomBytes as jest.MockedFunction<typeof randomBytes>;

const FIXED_TIMESTAMP_MS = 1_700_000_000_000;
const FIXED_TIMESTAMP_S  = Math.floor(FIXED_TIMESTAMP_MS / 1000);
const FIXED_NONCE_BYTE   = 0xab;
const FIXED_NONCE_HEX    = 'ab'.repeat(8);
const TURN_SECRET        = 'test-turn-secret';

function mockReq(sub: string) {
  return { user: { sub } } as any;
}

function mockRes() {
  const res: any = {};
  res.json = jest.fn();
  return res;
}

function computeExpectedPassword(username: string): string {
  return createHmac('sha1', TURN_SECRET).update(username).digest('base64');
}

// Set deterministic defaults before each test
let dateNowSpy: jest.SpyInstance;

beforeEach(() => {
  dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_TIMESTAMP_MS);
  mockRandomBytes.mockReturnValue(Buffer.alloc(8, FIXED_NONCE_BYTE) as any);
});

afterEach(() => {
  dateNowSpy.mockRestore();
  mockRandomBytes.mockReset();
});

describe('turnCredentials - response shape', () => {
  it('response body has exactly the keys username, password, ttl', () => {
    const req = mockReq('user-1');
    const res = mockRes();
    turnCredentials(req, res);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['password', 'ttl', 'username']);
  });

  it('ttl is always 3600', () => {
    const req = mockReq('user-1');
    const res = mockRes();
    turnCredentials(req, res);
    expect(res.json.mock.calls[0][0].ttl).toBe(3600);
  });

  it('username has the format {timestamp}:{nonce}:{sub}', () => {
    const req = mockReq('user-1');
    const res = mockRes();
    turnCredentials(req, res);
    const { username } = res.json.mock.calls[0][0];
    const parts = username.split(':');
    expect(parts).toHaveLength(3);
  });
});

describe('turnCredentials - username construction', () => {
  it('timestamp = Math.floor(Date.now()/1000) + 3600', () => {
    const expectedTimestamp = FIXED_TIMESTAMP_S + 3600;
    const req = mockReq('user-1');
    const res = mockRes();
    turnCredentials(req, res);
    const [ts] = res.json.mock.calls[0][0].username.split(':');
    expect(Number(ts)).toBe(expectedTimestamp);
  });

  it('nonce is the 16-char hex encoding of the 8 mocked bytes', () => {
    const req = mockReq('user-1');
    const res = mockRes();
    turnCredentials(req, res);
    const [, nonce] = res.json.mock.calls[0][0].username.split(':');
    expect(nonce).toBe(FIXED_NONCE_HEX);
  });

  it('third colon-segment of username equals req.user.sub', () => {
    const sub = 'user-abc-xyz';
    const req = mockReq(sub);
    const res = mockRes();
    turnCredentials(req, res);
    const parts = res.json.mock.calls[0][0].username.split(':');
    expect(parts[2]).toBe(sub);
  });
});

describe('turnCredentials - password (HMAC-SHA1)', () => {
  it('password is HMAC-SHA1(username, TURN_SECRET) in base64', () => {
    const sub = 'user-1';
    const req = mockReq(sub);
    const res = mockRes();
    turnCredentials(req, res);
    const { username, password } = res.json.mock.calls[0][0];
    expect(password).toBe(computeExpectedPassword(username));
  });

  it('password changes when sub changes', () => {
    const res1 = mockRes();
    const res2 = mockRes();
    turnCredentials(mockReq('user-A'), res1);
    turnCredentials(mockReq('user-B'), res2);
    expect(res1.json.mock.calls[0][0].password).not.toBe(res2.json.mock.calls[0][0].password);
  });

  it('password changes when Date.now() changes (different TTL windows)', () => {
    const res1 = mockRes();
    turnCredentials(mockReq('user-1'), res1);

    dateNowSpy.mockReturnValue(FIXED_TIMESTAMP_MS + 60_000); // 1 minute later
    const res2 = mockRes();
    turnCredentials(mockReq('user-1'), res2);

    expect(res1.json.mock.calls[0][0].password).not.toBe(res2.json.mock.calls[0][0].password);
  });

  it('password would differ if TURN_SECRET changed (all HMAC inputs matter)', () => {
    const sub = 'user-1';
    const req = mockReq(sub);
    const res = mockRes();
    turnCredentials(req, res);
    const { username, password } = res.json.mock.calls[0][0];

    const altPassword = createHmac('sha1', 'different-secret').update(username).digest('base64');
    expect(password).not.toBe(altPassword);
  });
});
