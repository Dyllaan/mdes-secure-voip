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

//
// HEALTH
//
describe.each([
  { name: 'DEMO_MODE off', env: { DEMO_MODE: 'false' } },
  { name: 'DEMO_MODE on',  env: { DEMO_MODE: 'true'  } },
])('GET /health (%s)', ({ env }) => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns 200 when all services are UP', async () => {
    const { app } = await loadApp(env);
    fetchSpy.mockResolvedValue({ ok: true } as Response);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });

  it('returns DEGRADED when one fails', async () => {
    const { app } = await loadApp(env);

    let count = 0;
    fetchSpy.mockImplementation(() => {
      count++;
      return Promise.resolve({ ok: count !== 1 } as Response);
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(207);
  });
});

//
// AUTH PROXY
//
describe.each([
  { name: 'DEMO_MODE off', env: { DEMO_MODE: 'false' } },
  { name: 'DEMO_MODE on',  env: { DEMO_MODE: 'true'  } },
])('/auth proxy (%s)', ({ env }) => {
  it('passes when breaker closed', async () => {
    const { app } = await loadApp(env);
    const res = await request(app).post('/auth/login');
    expect(res.status).toBe(200);
  });

  it('returns 503 when breaker open', async () => {
    const { app, breakers } = await loadApp(env);

    await breakers.auth.open();
    const res = await request(app).post('/auth/login');

    expect(res.status).toBe(503);
  });

  it('has correct rate limit header', async () => {
    const { app } = await loadApp(env);
    const res = await request(app).post('/auth/login');
    expect(res.headers['ratelimit-limit']).toBe('20');
  });
});

//
// REALTIME (demo mode matters here)
//
describe('realtime with demo mode OFF', () => {
  it('passes without Redis / demo checks', async () => {
    const { app } = await loadApp({ DEMO_MODE: 'false' });

    const token = makeJwt('user');
    const res = await request(app)
      .get('/realtime/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe('realtime with demo mode ON', () => {
  it('still passes (Redis fail-open)', async () => {
    const { app } = await loadApp({ DEMO_MODE: 'true' });

    const token = makeJwt('user');
    const res = await request(app)
      .get('/realtime/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

//
// TURN CREDENTIALS
//
describe.each([
  { name: 'DEMO_MODE off', env: { DEMO_MODE: 'false' } },
  { name: 'DEMO_MODE on',  env: { DEMO_MODE: 'true'  } },
])('GET /turn-credentials (%s)', ({ env }) => {
  it('returns 401 without token', async () => {
    const { app } = await loadApp(env);
    const res = await request(app).get('/turn-credentials');
    expect(res.status).toBe(401);
  });

  it('returns credentials with valid token', async () => {
    const { app } = await loadApp(env);

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
  { route: '/peerjs/test',    user: 'peer' },
])('$route auth behaviour', ({ route, user }) => {
  it('returns 401 without token', async () => {
    const { app } = await loadApp();
    const res = await request(app).get(route);
    expect(res.status).toBe(401);
  });

  it('passes with token', async () => {
    const { app } = await loadApp();

    const res = await request(app)
      .get(route)
      .set('Authorization', `Bearer ${makeJwt(user)}`);

    expect(res.status).toBe(200);
  });
});

//
// LOGIN (important: demo mode should not break this)
//
describe.each([
  { name: 'DEMO_MODE off', env: { DEMO_MODE: 'false' } },
  { name: 'DEMO_MODE on',  env: { DEMO_MODE: 'true'  } },
])('POST /auth/user/login (%s)', ({ env }) => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns 503 when upstream fails', async () => {
    const { app } = await loadApp(env);
    fetchSpy.mockRejectedValue(new Error('fail'));

    const res = await request(app)
      .post('/auth/user/login')
      .send({ username: 'a', password: 'b' });

    expect(res.status).toBe(503);
  });

  it('returns 200 on success', async () => {
    const { app } = await loadApp(env);

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