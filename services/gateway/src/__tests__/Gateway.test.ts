jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn().mockImplementation(() =>
    (_req: any, res: any, _next: any) => res.status(200).json({ proxied: true }),
  ),
}));

import request from 'supertest';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { app } from '../routes';
import { breakers } from '../middleware/middleware';
import { makeJwt } from './helpers/makeJwt';

const mockCreateProxy = createProxyMiddleware as jest.MockedFunction<typeof createProxyMiddleware>;

afterEach(() => {
  breakers.auth.close();
  breakers.realtime.close();
  breakers.hub.close();
  breakers.musicman.close();
});

describe('GET /health', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns 200 with status UP when all services respond ok', async () => {
    fetchSpy.mockResolvedValue({ ok: true } as Response);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.services).toEqual({
      auth: 'UP', realtime: 'UP', musicman: 'UP', hub: 'UP',
    });
  });

  it('returns 207 with status DEGRADED when one service returns ok: false', async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ ok: callCount !== 1 } as Response);
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(207);
    expect(res.body.status).toBe('DEGRADED');
  });

  it('returns 207 with DOWN for a service whose fetch throws', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if ((url as string).includes('auth')) return Promise.reject(new Error('network error'));
      return Promise.resolve({ ok: true } as Response);
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(207);
    expect(res.body.services.auth).toBe('DOWN');
  });

  it('timestamp field is a valid ISO 8601 string', async () => {
    fetchSpy.mockResolvedValue({ ok: true } as Response);
    const res = await request(app).get('/health');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});

describe('/auth proxy', () => {
  it('passes through when circuit breaker is closed', async () => {
    const res = await request(app).post('/auth/login');
    expect(res.status).toBe(200);
  });

  it('returns 503 when circuit breaker is open', async () => {
    await breakers.auth.open();
    const res = await request(app).post('/auth/login');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Auth');
  });

  it('RateLimit-Limit header equals 20', async () => {
    const res = await request(app).post('/auth/login');
    expect(res.headers['ratelimit-limit']).toBe('20');
  });

  it('proxy is created with pathRewrite stripping /auth prefix', () => {
    const calls = mockCreateProxy.mock.calls;
    const authProxyCall = calls.find(
      ([opts]: any[]) => opts?.target === 'http://auth:4000',
    );
    expect(authProxyCall).toBeDefined();
    expect(authProxyCall![0]).toMatchObject({
      pathRewrite: { '^/auth': '' },
    });
  });
});

describe('/realtime proxy', () => {
  it('passes through when circuit breaker is closed', async () => {
    const res = await request(app).get('/realtime/status');
    expect(res.status).toBe(200);
  });

  it('returns 503 when circuit breaker is open', async () => {
    await breakers.realtime.open();
    const res = await request(app).get('/realtime/status');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Realtime');
  });

  it('RateLimit-Limit header equals 100', async () => {
    const res = await request(app).get('/realtime/status');
    expect(res.headers['ratelimit-limit']).toBe('100');
  });
});

describe('/hub proxy', () => {
  it('passes through when circuit breaker is closed', async () => {
    const res = await request(app).get('/hub/channels');
    expect(res.status).toBe(200);
  });

  it('returns 503 when circuit breaker is open', async () => {
    await breakers.hub.open();
    const res = await request(app).get('/hub/channels');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Hub');
  });

  it('proxy is created with pathRewrite mapping /hub to /api', () => {
    const calls = mockCreateProxy.mock.calls;
    const hubProxyCall = calls.find(
      ([opts]: any[]) => opts?.target === 'http://hub:5000',
    );
    expect(hubProxyCall).toBeDefined();
    expect(hubProxyCall![0]).toMatchObject({
      pathRewrite: { '^/hub': '/api' },
    });
  });
});

describe('/musicman proxy', () => {
  it('passes through when circuit breaker is closed', async () => {
    const res = await request(app).post('/musicman/play');
    expect(res.status).toBe(200);
  });

  it('returns 503 when circuit breaker is open', async () => {
    await breakers.musicman.open();
    const res = await request(app).post('/musicman/play');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('MusicMan');
  });

  it('RateLimit-Limit header equals 30', async () => {
    const res = await request(app).post('/musicman/play');
    expect(res.headers['ratelimit-limit']).toBe('30');
  });

  it('proxy is created with extended 120s timeout', () => {
    const calls = mockCreateProxy.mock.calls;
    const musicProxyCall = calls.find(
      ([opts]: any[]) => opts?.target === 'http://musicman:8080',
    );
    expect(musicProxyCall).toBeDefined();
    expect(musicProxyCall![0]).toMatchObject({
      proxyTimeout: 120_000,
      timeout: 120_000,
    });
  });
});

describe('GET /turn-credentials', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/turn-credentials');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorised' });
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/turn-credentials')
      .set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('returns 200 with username, password, ttl for a valid token', async () => {
    const token = makeJwt('user-turn-test');
    const res = await request(app)
      .get('/turn-credentials')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: expect.any(String),
      password: expect.any(String),
      ttl: 3600,
    });
  });

  it('username contains the sub from the JWT', async () => {
    const sub   = 'user-sub-check';
    const token = makeJwt(sub);
    const res = await request(app)
      .get('/turn-credentials')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const parts = res.body.username.split(':');
    expect(parts[2]).toBe(sub);
  });

  it('X-Request-ID header is present on the response', async () => {
    const token = makeJwt('user-1');
    const res = await request(app)
      .get('/turn-credentials')
      .set('Authorization', `Bearer ${token}`);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('echoes sent x-request-id back as X-Request-ID', async () => {
    const token = makeJwt('user-1');
    const myId  = 'my-custom-request-id';
    const res = await request(app)
      .get('/turn-credentials')
      .set('Authorization', `Bearer ${token}`)
      .set('x-request-id', myId);
    expect(res.headers['x-request-id']).toBe(myId);
  });
});

describe('/socket.io HTTP', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/socket.io/test');
    expect(res.status).toBe(401);
  });

  it('passes through with a valid token', async () => {
    const token = makeJwt('user-ws');
    const res = await request(app)
      .get('/socket.io/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('/peerjs HTTP', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/peerjs/test');
    expect(res.status).toBe(401);
  });

  it('passes through with a valid token', async () => {
    const token = makeJwt('user-peer');
    const res = await request(app)
      .get('/peerjs/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('404 fallback handler', () => {
  it('returns 404 for an unknown GET route', async () => {
    const res = await request(app).get('/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('returns 404 for an unknown POST route', async () => {
    const res = await request(app).post('/also-unknown');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('returns 404 for a path that looks like but does not match a real route', async () => {
    const res = await request(app).get('/auth-typo');
    expect(res.status).toBe(404);
  });
});

describe('global middleware', () => {
  it('X-Request-ID header is present on every response', async () => {
    let fetchSpy: jest.SpyInstance;
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true } as Response);
    const res = await request(app).get('/health');
    fetchSpy.mockRestore();
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('Helmet sets X-Content-Type-Options: nosniff', async () => {
    let fetchSpy: jest.SpyInstance;
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true } as Response);
    const res = await request(app).get('/health');
    fetchSpy.mockRestore();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS preflight returns Access-Control-Allow-Origin for allowed origin', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('CORS preflight does not set Access-Control-Allow-Origin for disallowed origin', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Access-Control-Allow-Methods includes PUT and DELETE', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PUT');
    const methods = res.headers['access-control-allow-methods'] ?? '';
    expect(methods).toContain('PUT');
    expect(methods).toContain('DELETE');
  });
});

import { extractUpgradeToken } from '../config/upgradeToken';

describe('extractUpgradeToken', () => {
  function req(url?: string, authorization?: string): any {
    return { url, headers: authorization ? { authorization } : {} };
  }

  it('returns token from Authorization: Bearer header', () => {
    expect(extractUpgradeToken(req('/', 'Bearer mytoken'))).toBe('mytoken');
  });

  it('returns token from ?token= query param when no auth header', () => {
    expect(extractUpgradeToken(req('/socket.io?token=abc123'))).toBe('abc123');
  });

  it('header takes priority over query param when both are present', () => {
    const r = req('/socket.io?token=qparam', 'Bearer headertoken');
    expect(extractUpgradeToken(r)).toBe('headertoken');
  });

  it('returns null when neither header nor query param is present', () => {
    expect(extractUpgradeToken(req('/socket.io'))).toBeNull();
  });

  it('returns null for a malformed URL (URL constructor throws)', () => {
    expect(extractUpgradeToken(req('://bad-url'))).toBeNull();
  });

  it('returns null when Authorization header does not use Bearer scheme', () => {
    expect(extractUpgradeToken(req('/', 'Basic dXNlcjpwYXNz'))).toBeNull();
  });

  it('returns empty string when header is "Bearer " with no token (caller must validate)', () => {
    expect(extractUpgradeToken(req('/', 'Bearer '))).toBe('');
  });

  it('returns null when req.url is undefined', () => {
    expect(extractUpgradeToken(req(undefined))).toBeNull();
  });
});
