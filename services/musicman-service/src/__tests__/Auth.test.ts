let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch as typeof fetch;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

async function importFreshAuth() {
  jest.resetModules();
  return require('../Auth') as typeof import('../Auth');
}

describe('Auth', () => {
  describe('register()', () => {
    it('should POST to AUTH_URL/user/register with username and password', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 201, text: async () => '' });
      const Auth = await importFreshAuth();
      await Auth.register();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://auth:4000/user/register',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should resolve when status is 201', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 201, text: async () => '' });
      const Auth = await importFreshAuth();
      await expect(Auth.register()).resolves.toBeUndefined();
    });

    it('should resolve when status is 409 (already exists)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 409, text: async () => 'conflict' });
      const Auth = await importFreshAuth();
      await expect(Auth.register()).resolves.toBeUndefined();
    });

    it('should throw "Bot registration failed" after all retries when status is 500', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'internal error' });
      const Auth = await importFreshAuth();

      let caughtError: Error | undefined;
      const promise = Auth.register().catch((e: Error) => { caughtError = e; });

      await jest.runAllTimersAsync();
      await promise;

      expect(caughtError?.message).toMatch('Bot registration failed');
    });

    it('should succeed on a later retry (first 2 fail with 500, 3rd succeeds)', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
        .mockResolvedValue({ ok: true, status: 201, text: async () => '' });
      const Auth = await importFreshAuth();
      const promise = Auth.register();
      await jest.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('login()', () => {
    it('should POST to AUTH_URL/user/login', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok1' }) });
      const Auth = await importFreshAuth();
      await Auth.login();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://auth:4000/user/login',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return the token from response.accessToken', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok-access' }) });
      const Auth = await importFreshAuth();
      await expect(Auth.login()).resolves.toBe('tok-access');
    });

    it('should return the token from response.access_token if accessToken is absent', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ access_token: 'tok-snake' }) });
      const Auth = await importFreshAuth();
      await expect(Auth.login()).resolves.toBe('tok-snake');
    });

    it('should return the token from response.token as fallback', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ token: 'tok-plain' }) });
      const Auth = await importFreshAuth();
      await expect(Auth.login()).resolves.toBe('tok-plain');
    });

    it('should throw "No token found in auth response" after all retries when no token field is present', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ something: 'else' }) });
      const Auth = await importFreshAuth();

      let caughtError: Error | undefined;
      const promise = Auth.login().catch((e: Error) => { caughtError = e; });

      await jest.runAllTimersAsync();
      await promise;

      expect(caughtError?.message).toMatch('No token found in auth response');
    });

    it('should throw "Auth response was not JSON" after all retries when body is invalid JSON', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => 'not-json-at-all' });
      const Auth = await importFreshAuth();

      let caughtError: Error | undefined;
      const promise = Auth.login().catch((e: Error) => { caughtError = e; });

      await jest.runAllTimersAsync();
      await promise;

      expect(caughtError?.message).toMatch('Auth response was not JSON');
    });

    it('should store the token so getToken() returns it after login()', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'stored-tok' }) });
      const Auth = await importFreshAuth();
      await Auth.login();
      expect(Auth.getToken()).toBe('stored-tok');
    });

    it('should succeed on retry after an initial failure', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad' })
        .mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'retry-tok' }) });
      const Auth = await importFreshAuth();
      const promise = Auth.login();
      await jest.runAllTimersAsync();
      await expect(promise).resolves.toBe('retry-tok');
    });
  });

  describe('fetchTurnCredentials()', () => {
    it('should throw "Not authenticated" when login() has not been called', async () => {
      const Auth = await importFreshAuth();
      await expect(Auth.fetchTurnCredentials()).rejects.toThrow('Not authenticated');
    });

    it('should GET GATEWAY_URL/turn-credentials with a Bearer token', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'u', password: 'p', ttl: 3600 }) });
      const Auth = await importFreshAuth();
      await Auth.login();
      await Auth.fetchTurnCredentials();
      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://gateway:3000/turn-credentials',
        { headers: { Authorization: 'Bearer tok' } }
      );
    });

    it('should throw "Failed to fetch TURN credentials" when response is not ok', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok' }) })
        .mockResolvedValueOnce({ ok: false, status: 403 });
      const Auth = await importFreshAuth();
      await Auth.login();
      await expect(Auth.fetchTurnCredentials()).rejects.toThrow('Failed to fetch TURN credentials');
    });
  });

  describe('getToken()', () => {
    it('should throw "Not authenticated" before login()', async () => {
      const Auth = await importFreshAuth();
      expect(() => Auth.getToken()).toThrow('Not authenticated');
    });

    it('should return the stored token after a successful login()', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'mytoken' }) });
      const Auth = await importFreshAuth();
      await Auth.login();
      expect(Auth.getToken()).toBe('mytoken');
    });
  });

  describe('startTokenRefresh()', () => {
    it('should call login() and fetchTurnCredentials() when the interval fires', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok1' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'u', password: 'p', ttl: 3600 }) });

      const Auth = await importFreshAuth();
      await Auth.login();
      await Auth.fetchTurnCredentials();
      mockFetch.mockClear();

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok-refresh' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'u2', password: 'p2', ttl: 1800 }) });

      Auth.startTokenRefresh();
      await jest.advanceTimersByTimeAsync(50 * 60 * 1000 + 1);

      const urls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(urls).toContain('http://auth:4000/user/login');
      expect(urls).toContain('http://gateway:3000/turn-credentials');

      Auth.stopTokenRefresh();
    });

    it('should not create a second interval if already started', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok' }) });
      const Auth = await importFreshAuth();
      await Auth.login();

      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      Auth.startTokenRefresh();
      Auth.startTokenRefresh();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      Auth.stopTokenRefresh();
      setIntervalSpy.mockRestore();
    });
  });

  describe('stopTokenRefresh()', () => {
    it('should be safe to call when no timer is running', async () => {
      const Auth = await importFreshAuth();
      expect(() => Auth.stopTokenRefresh()).not.toThrow();
    });

    it('should prevent the refresh interval from firing after stop', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ accessToken: 'tok' }) });
      const Auth = await importFreshAuth();
      await Auth.login();

      Auth.startTokenRefresh();
      Auth.stopTokenRefresh();
      mockFetch.mockClear();

      await jest.advanceTimersByTimeAsync(50 * 60 * 1000 + 1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});