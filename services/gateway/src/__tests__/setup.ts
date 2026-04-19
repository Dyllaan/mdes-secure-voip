import { readFileSync } from 'fs';
import { resolve } from 'path';

const testPublicKey = readFileSync(resolve(__dirname, '../../../../test-fixtures/jwt/public.pem'), 'utf8');

process.env.CORS_ORIGIN          = 'http://localhost:3000';
process.env.AUTH_SERVICE_URL     = 'http://auth:4000';
process.env.REALTIME_SERVICE_URL = 'http://realtime:3001';
process.env.PEER_SERVICE_URL     = 'http://peer:9000';
process.env.HUB_SERVICE_URL      = 'http://hub:5000';
process.env.MUSICMAN_URL         = 'http://musicman:8080';
process.env.TURN_SECRET          = 'test-turn-secret';
process.env.JWT_PUBLIC_KEY_B64   = Buffer.from(testPublicKey).toString('base64');
process.env.MAX_REQUEST_BODY_BYTES  = '1048576';
