import { readFileSync } from 'fs';
import { resolve } from 'path';

const testPublicKey = readFileSync(resolve(__dirname, '../../../../test-fixtures/jwt/public.pem'), 'utf8');

process.env.SIGNALING_URL   = 'http://signaling:3001';
process.env.HUB_SERVICE_URL = 'http://hub:3000';
process.env.AUTH_URL        = 'http://auth:4000';
process.env.GATEWAY_URL     = 'http://gateway:3000';
process.env.PEER_HOST       = 'peer.test';
process.env.BOT_USERNAME    = 'testbot';
process.env.BOT_PASSWORD    = 'testpass';
process.env.BOT_SECRET      = 'botsecret';
process.env.JWT_PUBLIC_KEY_B64 = Buffer.from(testPublicKey).toString('base64');
process.env.TURN_HOST       = 'turn.test';
