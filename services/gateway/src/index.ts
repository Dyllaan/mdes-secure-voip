import http from 'http';
import { createVerifier } from 'fast-jwt';
import { Buffer } from 'buffer';
import { app, socketIoProxy, peerJsProxy } from './routes';
import { config, logger } from './config/config';
import { extractUpgradeToken } from './config/upgradeToken';
import { connectRedis } from './redis';

const server = http.createServer(app);

const upgradeVerify = createVerifier({
  key: Buffer.from(config.JWT_SECRET, 'base64'),
  algorithms: ['HS256'],
});

server.on('upgrade', (req, socket, head) => {
  logger.debug({ url: req.url }, 'Upgrade request');

  const isPeerJs = req.url?.startsWith('/peerjs');

  if (!isPeerJs) {
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
  }

  if (req.url?.startsWith('/socket.io')) {
    (socketIoProxy as any).upgrade(req as any, socket, head);
  } else if (isPeerJs) {
    (peerJsProxy as any).upgrade(req as any, socket, head);
  } else {
    logger.warn({ url: req.url }, 'Unknown upgrade path, destroying socket');
    socket.destroy();
  }
});
(async () => {
  await connectRedis();
  server.listen(config.PORT, () => {
    logger.info({
      port: config.PORT,
      authService: config.AUTH_SERVICE_URL,
      realtimeService: config.REALTIME_SERVICE_URL,
      peerService: config.PEER_SERVICE_URL,
      hubService: config.HUB_SERVICE_URL,
    }, 'API Gateway running');
  });
})();

export default server;