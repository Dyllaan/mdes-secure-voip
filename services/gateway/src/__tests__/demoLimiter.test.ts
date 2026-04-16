describe('demoLimiter', () => {
  const ORIGINAL_ENV = process.env;

  function mockReq(sub: string) {
    return { user: { sub } } as any;
  }

  function mockRes() {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  async function loadDemoLimiter(env: Record<string, string | undefined> = {}) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, ...env };

    const mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      incrBy: jest.fn(),
      isOpen: true,
    };

    jest.doMock('../redis', () => ({
      redis: mockRedis,
    }));

    const demoLimiter = await import('../middleware/demoLimiter');

    return {
      ...demoLimiter,
      mockRedis,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
    jest.dontMock('../redis');
    jest.restoreAllMocks();
  });

  describe('onLogin', () => {
    it('sets the start key to current unix timestamp', async () => {
      const { onLogin, mockRedis } = await loadDemoLimiter();
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

      await onLogin('user-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'demo:user-1:start',
        1_700_000_000
      );
    });

    it('sets used key to 0 with NX flag', async () => {
      const { onLogin, mockRedis } = await loadDemoLimiter();

      await onLogin('user-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'demo:user-1:used',
        0,
        { NX: true }
      );
    });
  });

  describe('onLogout', () => {
    it('does nothing when start key is absent', async () => {
      const { onLogout, mockRedis } = await loadDemoLimiter();
      mockRedis.get.mockResolvedValue(null);

      await onLogout('user-1');

      expect(mockRedis.incrBy).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('increments used by elapsed seconds and deletes start key', async () => {
      const { onLogout, mockRedis } = await loadDemoLimiter();
      const startSec = 1_700_000_000;

      jest.spyOn(Date, 'now').mockReturnValue((startSec + 300) * 1000);
      mockRedis.get.mockResolvedValue(String(startSec));

      await onLogout('user-1');

      expect(mockRedis.incrBy).toHaveBeenCalledWith('demo:user-1:used', 300);
      expect(mockRedis.del).toHaveBeenCalledWith('demo:user-1:start');
    });
  });

  describe('demoGuard', () => {
    it('calls next() immediately when DEMO_MODE is not set', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: undefined,
        UNRESTRICTED_USERNAMES: '',
      });

      const next = jest.fn();

      await demoGuard(mockReq('user-1'), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('calls next() when DEMO_MODE is false', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: 'false',
        UNRESTRICTED_USERNAMES: '',
      });

      const next = jest.fn();

      await demoGuard(mockReq('user-1'), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('calls next() when user is in UNRESTRICTED_USERNAMES', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: 'true',
        UNRESTRICTED_USERNAMES: 'admin',
      });

      const next = jest.fn();

      await demoGuard(mockReq('admin'), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('returns 403 with DEMO_EXPIRED when usage meets the limit', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: 'true',
        DEMO_TIME_LIMIT_SECONDS: '10800',
        UNRESTRICTED_USERNAMES: '',
      });

      mockRedis.get
        .mockResolvedValueOnce('10800')
        .mockResolvedValueOnce(null);

      const res = mockRes();
      const next = jest.fn();

      await demoGuard(mockReq('user-1'), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'DEMO_EXPIRED' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when usage is below the limit', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: 'true',
        DEMO_TIME_LIMIT_SECONDS: '10800',
        UNRESTRICTED_USERNAMES: '',
      });

      mockRedis.get
        .mockResolvedValueOnce('100')
        .mockResolvedValueOnce(null);

      const next = jest.fn();

      await demoGuard(mockReq('user-1'), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('accounts for active session delta when start key is present', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: 'true',
        DEMO_TIME_LIMIT_SECONDS: '10800',
        UNRESTRICTED_USERNAMES: '',
      });

      const startSec = 1_700_000_000;
      jest.spyOn(Date, 'now').mockReturnValue((startSec + 10_700) * 1000);

      mockRedis.get
        .mockResolvedValueOnce('100')
        .mockResolvedValueOnce(String(startSec));

      const res = mockRes();
      const next = jest.fn();

      await demoGuard(mockReq('user-1'), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when total usage including active session is still below the limit', async () => {
      const { demoGuard, mockRedis } = await loadDemoLimiter({
        DEMO_MODE: 'true',
        DEMO_TIME_LIMIT_SECONDS: '10800',
        UNRESTRICTED_USERNAMES: '',
      });

      const startSec = 1_700_000_000;
      jest.spyOn(Date, 'now').mockReturnValue((startSec + 60) * 1000);

      mockRedis.get
        .mockResolvedValueOnce('100')
        .mockResolvedValueOnce(String(startSec));

      const next = jest.fn();

      await demoGuard(mockReq('user-1'), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});