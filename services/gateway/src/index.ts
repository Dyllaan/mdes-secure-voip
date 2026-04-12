import http from 'http';
import { createVerifier } from 'fast-jwt';
import { Buffer } from 'buffer';
import { app, socketIoProxy, peerJsProxy } from './Gateway';
import { config, logger } from './config';
import { extractUpgradeToken } from './upgradeToken';

const server = http.createServer(app);

// Reuse the same verifier as authMiddleware.ts so key/algorithm handling is consistent.
const upgradeVerify = createVerifier({
  key: Buffer.from(config.JWT_SECRET, 'base64'),
  algorithms: ['HS256'],
});


server.on('upgrade', (req, socket, head) => {
  logger.debug({ url: req.url }, 'Upgrade request');

  /**If a token is present in HTTP headers/query, validate it now at the gateway
   boundary. If no token is present at the HTTP level, allow the upgrade through
   Socket.IO sends auth via its own protocol handshake, which the realtime service's
   io.use() middleware validates independently. */
  const token = extractUpgradeToken(req);
  if (token !== null) {
    try {
      upgradeVerify(token);
    } catch {
      logger.warn({ url: req.url }, 'WebSocket upgrade rejected: invalid token');
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  if (req.url?.startsWith('/socket.io')) {
    (socketIoProxy as any).upgrade(req as any, socket, head);
  } else if (req.url?.startsWith('/peerjs')) {
    (peerJsProxy as any).upgrade(req as any, socket, head);
  } else {
    logger.warn({ url: req.url }, 'Unknown upgrade path, destroying socket');
    socket.destroy();
  }
});

server.listen(config.PORT, () => {
  logger.info({
    port: config.PORT,
    authService: config.AUTH_SERVICE_URL,
    realtimeService: config.REALTIME_SERVICE_URL,
    peerService: config.PEER_SERVICE_URL,
    hubService: config.HUB_SERVICE_URL,
  }, 'API Gateway running');
});

export default server;