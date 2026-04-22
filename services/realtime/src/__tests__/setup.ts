import { readFileSync } from 'fs';
import { resolve } from 'path';

const testPublicKey = readFileSync(resolve(__dirname, '../../../../test-fixtures/jwt/public.pem'), 'utf8');

process.env.JWT_PUBLIC_KEY_B64 = Buffer.from(testPublicKey).toString('base64');
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.HUB_SERVICE_URL = 'http://hub-test:3000';
