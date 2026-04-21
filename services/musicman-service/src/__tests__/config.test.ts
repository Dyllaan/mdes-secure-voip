// Each test resets all env vars and re-imports the config module using jest.resetModules()
const { readFileSync } = require('fs');
const { resolve } = require('path');

const REQUIRED_VARS = ['SIGNALING_URL', 'HUB_SERVICE_URL', 'AUTH_URL', 'GATEWAY_URL', 'PEER_HOST', 'BOT_USERNAME', 'BOT_PASSWORD', 'BOT_SECRET', 'JWT_PUBLIC_KEY_B64', 'TURN_HOST'];
const TEST_PUBLIC_KEY = readFileSync(resolve(__dirname, '../../../../test-fixtures/jwt/public.pem'), 'utf8');

function setAllEnvVars() {
  process.env.SIGNALING_URL   = 'http://signaling:3001';
  process.env.HUB_SERVICE_URL = 'http://hub:3000';
  process.env.AUTH_URL        = 'http://auth:4000';
  process.env.GATEWAY_URL     = 'http://gateway:3000';
  process.env.PEER_HOST       = 'peer.test';
  process.env.BOT_USERNAME    = 'testbot';
  process.env.BOT_PASSWORD    = 'testpass';
  process.env.BOT_SECRET      = 'botsecret';
  process.env.JWT_PUBLIC_KEY_B64 = Buffer.from(TEST_PUBLIC_KEY).toString('base64');
  process.env.TURN_HOST       = 'turn.test';
  delete process.env.DEBUG;
  delete process.env.DEBUG_AV;
  delete process.env.DEBUG_AV_VERBOSE;
}

afterEach(() => {
  // Restore all required vars
  setAllEnvVars();
  jest.resetModules();
});

describe('config module', () => {
  describe('required environment variables', () => {
    for (const varName of REQUIRED_VARS) {
      it(`should throw "Missing required env var: ${varName}" when ${varName} is absent`, () => {
        setAllEnvVars();
        delete process.env[varName];
        jest.resetModules();
        expect(() => require('../config')).toThrow(`Missing required env var: ${varName}`);
      });
    }

    it('should throw when JWT_PUBLIC_KEY_B64 is malformed', () => {
      setAllEnvVars();
      process.env.JWT_PUBLIC_KEY_B64 = Buffer.from('bad-key').toString('base64');
      jest.resetModules();
      expect(() => require('../config')).toThrow('Invalid JWT_PUBLIC_KEY_B64');
    });
  });

  describe('optional variables with defaults', () => {
    it('should default PEER_PORT to 443 when not set', () => {
      setAllEnvVars();
      delete process.env.PEER_PORT;
      jest.resetModules();
      const { config } = require('../config');
      expect(config.PEER_PORT).toBe(443);
    });

    it('should parse PEER_PORT as integer when set', () => {
      setAllEnvVars();
      process.env.PEER_PORT = '9000';
      jest.resetModules();
      const { config } = require('../config');
      expect(config.PEER_PORT).toBe(9000);
    });

    it('should default PEER_PATH to "/peerjs" when not set', () => {
      setAllEnvVars();
      delete process.env.PEER_PATH;
      jest.resetModules();
      const { config } = require('../config');
      expect(config.PEER_PATH).toBe('/peerjs');
    });

    it('should default PEER_SECURE to true when PEER_SECURE is not set', () => {
      setAllEnvVars();
      delete process.env.PEER_SECURE;
      jest.resetModules();
      const { config } = require('../config');
      expect(config.PEER_SECURE).toBe(true);
    });

    it('should set PEER_SECURE to false when PEER_SECURE=false', () => {
      setAllEnvVars();
      process.env.PEER_SECURE = 'false';
      jest.resetModules();
      const { config } = require('../config');
      expect(config.PEER_SECURE).toBe(false);
    });

    it('should default PORT to 4000 when not set', () => {
      setAllEnvVars();
      delete process.env.PORT;
      jest.resetModules();
      const { config } = require('../config');
      expect(config.PORT).toBe(4000);
    });

    it('should default DEBUG to false when not set', () => {
      setAllEnvVars();
      jest.resetModules();
      const { config } = require('../config');
      expect(config.DEBUG).toBe(false);
    });

    it('should parse DEBUG as true for boolean-ish values', () => {
      setAllEnvVars();
      process.env.DEBUG = 'true';
      jest.resetModules();
      const { config } = require('../config');
      expect(config.DEBUG).toBe(true);
    });

    it('should ignore legacy AV debug env vars', () => {
      setAllEnvVars();
      process.env.DEBUG_AV = '1';
      process.env.DEBUG_AV_VERBOSE = '1';
      jest.resetModules();
      const { config } = require('../config');
      expect(config.DEBUG).toBe(false);
    });
  });
});
