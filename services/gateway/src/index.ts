import http from 'http';
import { app, socketIoProxy, peerJsProxy } from './routes';
import { config, logger } from './config/config';

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  logger.debug({ url: req.url }, 'Upgrade request');

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
