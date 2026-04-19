const REQUIRED_VARS = [
  'CORS_ORIGIN',
  'AUTH_SERVICE_URL',
  'REALTIME_SERVICE_URL',
  'PEER_SERVICE_URL',
  'HUB_SERVICE_URL',
  'MUSICMAN_URL',
  'TURN_SECRET',
  'JWT_PUBLIC_KEY_B64',
];

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALhhsn6g9oK7U0GeN7mXa+ljh8p2dD5k
6ojgI3GC4cd0XUMDKM5YvK5n+0sIVxWEqYg+YxvL2ZqL9Dhv8ZKJQw8CAwEAAQ==
-----END PUBLIC KEY-----
`;

const VALID_ENV: Record<string, string> = {
  CORS_ORIGIN:                'http://localhost:3000',
  AUTH_SERVICE_URL:           'http://auth:4000',
  REALTIME_SERVICE_URL:       'http://realtime:3001',
  PEER_SERVICE_URL:           'http://peer:9000',
  HUB_SERVICE_URL:            'http://hub:5000',
  MUSICMAN_URL:               'http://musicman:8080',
  TURN_SECRET:                'test-turn-secret',
  JWT_PUBLIC_KEY_B64:         Buffer.from(TEST_PUBLIC_KEY).toString('base64'),
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
    delete process.env.JWT_PUBLIC_KEY_B64;
    let message = '';
    try {
      require('../config/config');
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain('CORS_ORIGIN');
    expect(message).toContain('TURN_SECRET');
    expect(message).toContain('JWT_PUBLIC_KEY_B64');
  });

  it('does not throw when all required vars are present', () => {
    expect(() => require('../config/config')).not.toThrow();
  });

  it('throws when JWT_PUBLIC_KEY_B64 is malformed', () => {
    process.env.JWT_PUBLIC_KEY_B64 = Buffer.from('not-a-public-key').toString('base64');
    expect(() => require('../config/config')).toThrow('Invalid JWT_PUBLIC_KEY_B64');
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
