const REQUIRED_ENV = {
    JWT_PUBLIC_KEY_B64: Buffer.from(`-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALhhsn6g9oK7U0GeN7mXa+ljh8p2dD5k
6ojgI3GC4cd0XUMDKM5YvK5n+0sIVxWEqYg+YxvL2ZqL9Dhv8ZKJQw8CAwEAAQ==
-----END PUBLIC KEY-----
`).toString('base64'),
    ALLOWED_ORIGINS: 'http://localhost:3000',
    HUB_SERVICE_URL: 'http://hub-test:3000',
};

function restoreEnv() {
    process.env.JWT_PUBLIC_KEY_B64 = REQUIRED_ENV.JWT_PUBLIC_KEY_B64;
    process.env.ALLOWED_ORIGINS = REQUIRED_ENV.ALLOWED_ORIGINS;
    process.env.HUB_SERVICE_URL = REQUIRED_ENV.HUB_SERVICE_URL;
}

beforeEach(() => {
    jest.resetModules();
    restoreEnv();
});

afterAll(() => {
    restoreEnv();
});

describe('realtime config', () => {
    it('throws when JWT_PUBLIC_KEY_B64 is missing', () => {
        delete process.env.JWT_PUBLIC_KEY_B64;
        expect(() => require('../config')).toThrow('JWT_PUBLIC_KEY_B64');
    });

    it('throws when JWT_PUBLIC_KEY_B64 is malformed', () => {
        process.env.JWT_PUBLIC_KEY_B64 = Buffer.from('bad-key').toString('base64');
        expect(() => require('../config')).toThrow('Invalid JWT_PUBLIC_KEY_B64');
    });

    it('loads when required env vars are valid', () => {
        expect(() => require('../config')).not.toThrow();
    });
});
