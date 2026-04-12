process.env.JWT_SECRET = Buffer.from('test-secret').toString('base64');
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.HUB_SERVICE_URL = 'http://hub-test:3000';
