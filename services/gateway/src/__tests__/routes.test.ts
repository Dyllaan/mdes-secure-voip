jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn().mockImplementation(() =>
    (_req: any, res: any) => res.status(200).json({ proxied: true }),
  ),
}));

import request from 'supertest';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { makeJwt } from './helpers/makeJwt';

const mockCreateProxy = createProxyMiddleware as jest.MockedFunction<typeof createProxyMiddleware>;

const ORIGINAL_ENV = process.env;

async function loadApp(env: Record<string, string | undefined> = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  const { app } = await import('../routes');
  const { breakers } = await import('../middleware/middleware');

  return { app, breakers };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.clearAllMocks();
});

describe('GET /health', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns 200 when all services are UP', async () => {
    const { app } = await loadApp();
    fetchSpy.mockResolvedValue({ ok: true } as Response);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });

  it('returns DEGRADED when one fails', async () => {
    const { app } = await loadApp();

    let count = 0;
    fetchSpy.mockImplementation(() => {
      count++;
      return Promise.resolve({ ok: count !== 1 } as Response);
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(207);
  });
});

describe('/auth proxy', () => {
  it('passes when breaker closed', async () => {
    const { app } = await loadApp();
    const res = await request(app).post('/auth/login');
    expect(res.status).toBe(200);
  });

  it('returns 503 when breaker open', async () => {
    const { app, breakers } = await loadApp();

    await breakers.auth.open();
    const res = await request(app).post('/auth/login');

    expect(res.status).toBe(503);
  });

  it('has correct rate limit header', async () => {
    const { app } = await loadApp();
    const res = await request(app).post('/auth/login');
    expect(res.headers['ratelimit-limit']).toBe('5');
  });
});

describe('GET /realtime/status', () => {
  it('requires auth and passes through with a valid token', async () => {
    const { app } = await loadApp();

    const unauthorized = await request(app).get('/realtime/status');
    expect(unauthorized.status).toBe(401);

    const authorized = await request(app)
      .get('/realtime/status')
      .set('Authorization', `Bearer ${makeJwt('user')}`);

    expect(authorized.status).toBe(200);
  });
});

describe('GET /turn-credentials', () => {
  it('returns 401 without token', async () => {
    const { app } = await loadApp();
    const res = await request(app).get('/turn-credentials');
    expect(res.status).toBe(401);
  });

  it('returns credentials with valid token', async () => {
    const { app } = await loadApp();

    const token = makeJwt('user');
    const res = await request(app)
      .get('/turn-credentials')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toContain('user');
  });
});

//
// SOCKET.IO + PEERJS
//
describe.each([
  { route: '/socket.io/test', user: 'ws' },
])('$route proxy behaviour', ({ route, user }) => {
  it('passes through without token', async () => {
    const { app } = await loadApp();
    const res = await request(app).get(route);
    expect(res.status).toBe(200);
  });

  it('passes with token', async () => {
    const { app } = await loadApp();

    const res = await request(app)
      .get(route)
      .set('Authorization', `Bearer ${makeJwt(user)}`);

    expect(res.status).toBe(200);
  });
});

describe('/peerjs proxy behaviour', () => {
  it('rejects unauthenticated requests', async () => {
    const { app } = await loadApp();
    const res = await request(app).get('/peerjs/test');
    expect(res.status).toBe(401);
  });

  it('accepts a valid access token in the query string', async () => {
    const { app } = await loadApp();
    const res = await request(app).get(`/peerjs/test?token=${makeJwt('peer')}`);
    expect(res.status).toBe(200);
  });

  it('rejects refresh tokens on peer routes', async () => {
    const { app } = await loadApp();
    const res = await request(app).get(`/peerjs/test?token=${makeJwt('peer', { tokenUse: 'refresh', audience: 'auth-service' })}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/user/login', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns 503 when upstream fails', async () => {
    const { app } = await loadApp();
    fetchSpy.mockRejectedValue(new Error('fail'));

    const res = await request(app)
      .post('/auth/user/login')
      .send({ username: 'a', password: 'b' });

    expect(res.status).toBe(503);
  });

  it('returns 200 on success', async () => {
    const { app } = await loadApp();

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accessToken: makeJwt('a') }),
    } as any);

    const res = await request(app)
      .post('/auth/user/login')
      .send({ username: 'a', password: 'b' });

    expect(res.status).toBe(200);
  });

  it('passes through a DEMO_EXPIRED response from auth', async () => {
    const { app } = await loadApp();

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'Demo limit reached', code: 'DEMO_EXPIRED' }),
    } as any);

    const res = await request(app)
      .post('/auth/user/login')
      .send({ username: 'a', password: 'b' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ code: 'DEMO_EXPIRED' }));
  });
});

describe('POST /auth/user/refresh', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns 403 with DEMO_EXPIRED when auth denies refresh', async () => {
    const { app } = await loadApp();

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'Demo limit reached', code: 'DEMO_EXPIRED' }),
    } as any);

    const res = await request(app)
      .post('/auth/user/refresh')
      .send({ refreshToken: 'r1' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ code: 'DEMO_EXPIRED' }));
  });

  it('returns 200 and refreshed tokens when auth refresh succeeds', async () => {
    const { app } = await loadApp();

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accessToken: makeJwt('fresh-user'), refreshToken: 'r2' }),
    } as any);

    const res = await request(app)
      .post('/auth/user/refresh')
      .send({ refreshToken: 'r1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ refreshToken: 'r2' }));
  });
});

//
// 404
//
describe('404 fallback', () => {
  it('returns 404', async () => {
    const { app } = await loadApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
