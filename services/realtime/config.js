const config = {
  services: {
    realtime: {
      port: process.env.REALTIME_PORT || 3001,
      peerPort: process.env.PEER_PORT || 9000
    }
  },
  jwt: {
    secret: process.env.JWT_SECRET || (() => {
      throw new Error('JWT_SECRET environment variable is required');
    })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  security: {
    maxMessageLength: 500,
    maxAliasLength: 50,
    maxRoomIdLength: 20,
    socketRateLimitWindow: 60000, // 1 minute
    socketRateLimitMax: 100, // 100 actions per minute
    apiRateLimitWindow: 15 * 60 * 1000, // 15 minutes
    apiRateLimitMax: 100, // 100 requests per 15 minutes
    maxQueuedMessages: 100, // Max messages per user queue
    maxPrekeyRefreshPerHour: 10
  },
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://localhost:8080"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
};

module.exports = config;