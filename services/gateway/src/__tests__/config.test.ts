const REQUIRED_VARS = [
  'CORS_ORIGIN',
  'AUTH_SERVICE_URL',
  'REALTIME_SERVICE_URL',
  'PEER_SERVICE_URL',
  'HUB_SERVICE_URL',
  'MUSICMAN_URL',
  'TURN_SECRET',
  'JWT_SECRET',
  'REDIS_URL',
];

const VALID_ENV: Record<string, string> = {
  CORS_ORIGIN:                'http://localhost:3000',
  AUTH_SERVICE_URL:           'http://auth:4000',
  REALTIME_SERVICE_URL:       'http://realtime:3001',
  PEER_SERVICE_URL:           'http://peer:9000',
  HUB_SERVICE_URL:            'http://hub:5000',
  MUSICMAN_URL:               'http://musicman:8080',
  TURN_SECRET:                'test-turn-secret',
  JWT_SECRET:                 Buffer.from('test-jwt-secret').toString('base64'),
  REDIS_URL:                  'redis://localhost:6379',
};

function restoreEnv() {
  for (const [k, v] of Object.entries(VALID_ENV)) {
    process.env[k] = v;
  }
}

beforeEach(() => {
  jest.resetModules();
  restoreEnv();
});

afterAll(() => {
  restoreEnv();
});

describe('config - required variable validation', () => {
  test.each(REQUIRED_VARS)('throws when %s is missing', (varName) => {
    delete process.env[varName];
    expect(() => require('../config/config')).toThrow('Missing required environment variables');
  });

  test.each(REQUIRED_VARS)('error message includes the missing var name (%s)', (varName) => {
    delete process.env[varName];
    expect(() => require('../config/config')).toThrow(varName);
  });

  it('throws and includes all missing var names when multiple are absent', () => {
    delete process.env.CORS_ORIGIN;
    delete process.env.TURN_SECRET;
    delete process.env.JWT_SECRET;
    let message = '';
    try {
      require('../config/config');
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain('CORS_ORIGIN');
    expect(message).toContain('TURN_SECRET');
    expect(message).toContain('JWT_SECRET');
  });

  it('does not throw when all required vars are present', () => {
    expect(() => require('../config/config')).not.toThrow();
  });
});

describe('config - optional variable defaults', () => {
  it('NODE_ENV defaults to "development"', () => {
    delete process.env.NODE_ENV;
    const { config } = require('../config/config');
    expect(config.NODE_ENV).toBe('development');
  });

  it('PORT defaults to 3000', () => {
    delete process.env.PORT;
    const { config } = require('../config/config');
    expect(config.PORT).toBe(3000);
  });

  it('LOG_LEVEL defaults to "info"', () => {
    delete process.env.LOG_LEVEL;
    const { config } = require('../config/config');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('NODE_ENV reads from env when set', () => {
    process.env.NODE_ENV = 'production';
    const { config } = require('../config/config');
    expect(config.NODE_ENV).toBe('production');
  });
});

describe('config - exports', () => {
  it('exports a logger object', () => {
    const { logger } = require('../config/config');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('exports a config object with all required keys', () => {
    const { config } = require('../config/config');
    for (const k of REQUIRED_VARS) {
      expect(config).toHaveProperty(k);
    }
  });
});

describe('config - parsed optional vars', () => {
  it('DEMO_TIME_LIMIT_SECONDS parses env string to number', () => {
    process.env.DEMO_TIME_LIMIT_SECONDS = '7200';
    const { config } = require('../config/config');
    expect(config.DEMO_TIME_LIMIT_SECONDS).toBe(7200);
  });

  it('DEMO_TIME_LIMIT_SECONDS defaults to 10800 when absent', () => {
    delete process.env.DEMO_TIME_LIMIT_SECONDS;
    const { config } = require('../config/config');
    expect(config.DEMO_TIME_LIMIT_SECONDS).toBe(10800);
  });

  it('DEMO_MODE is true only when env var is exactly the string "true"', () => {
    process.env.DEMO_MODE = 'true';
    const { config } = require('../config/config');
    expect(config.DEMO_MODE).toBe(true);
  });

  it('DEMO_MODE is false for any value other than "true"', () => {
    process.env.DEMO_MODE = '1';
    const { config } = require('../config/config');
    expect(config.DEMO_MODE).toBe(false);
  });

  it('DEMO_MODE is false when absent', () => {
    delete process.env.DEMO_MODE;
    const { config } = require('../config/config');
    expect(config.DEMO_MODE).toBe(false);
  });

  it('UNRESTRICTED_USERNAMES is a Set of trimmed entries', () => {
    process.env.UNRESTRICTED_USERNAMES = 'alice, bob , charlie';
    const { config } = require('../config/config');
    expect(config.UNRESTRICTED_USERNAMES).toBeInstanceOf(Set);
    expect(config.UNRESTRICTED_USERNAMES.has('alice')).toBe(true);
    expect(config.UNRESTRICTED_USERNAMES.has('bob')).toBe(true);
    expect(config.UNRESTRICTED_USERNAMES.has('charlie')).toBe(true);
  });

  it('UNRESTRICTED_USERNAMES is an empty Set when absent', () => {
    delete process.env.UNRESTRICTED_USERNAMES;
    const { config } = require('../config/config');
    expect(config.UNRESTRICTED_USERNAMES.size).toBe(0);
  });

  it('MAX_REQUEST_BODY_BYTES parses env string to number', () => {
    process.env.MAX_REQUEST_BODY_BYTES = '2097152';
    const { config } = require('../config/config');
    expect(config.MAX_REQUEST_BODY_BYTES).toBe(2097152);
  });

  it('MAX_REQUEST_BODY_BYTES defaults to 1048576 when absent', () => {
    delete process.env.MAX_REQUEST_BODY_BYTES;
    const { config } = require('../config/config');
    expect(config.MAX_REQUEST_BODY_BYTES).toBe(1048576);
  });
});