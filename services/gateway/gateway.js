const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const http = require('http');
require('dotenv').config({
  path: process.env.NODE_ENV === 'docker' ? '.env.docker' : '.env.local'
});

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Auth Service
app.use('/auth', createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL || 'http://localhost:3003',
  changeOrigin: true,
  pathRewrite: { '^/auth': '' },
  onError: (err, req, res) => {
    console.error('Error proxying to auth service:', err.message);
    res.status(503).json({ error: 'Auth service unavailable' });
  },
}));

// Realtime Service HTTP endpoints
app.use('/api/realtime', createProxyMiddleware({
  target: process.env.REALTIME_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: { '^/api/realtime': '/api' },
  onError: (err, req, res) => {
    console.error('Error proxying to realtime service:', err.message);
    res.status(503).json({ error: 'Realtime service unavailable' });
  },
}));

// Realtime health check
app.use('/realtime/health', createProxyMiddleware({
  target: process.env.REALTIME_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: { '^/realtime/health': '/health' },
  onError: (err, req, res) => {
    console.error('Error proxying to realtime health:', err.message);
    res.status(503).json({ error: 'Realtime service unavailable' });
  },
}));

// Socket.IO proxy
const socketIoProxy = createProxyMiddleware({
  target: process.env.REALTIME_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  onProxyReqWs: (proxyReq, req, socket) => {
    console.log(' WebSocket upgrade - Socket.IO');
    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  },
  onError: (err, req, res) => {
    console.error('Error proxying Socket.IO:', err.message);
  },
});

app.use('/socket.io', socketIoProxy);

const peerJsProxy = createProxyMiddleware({
  target: process.env.PEER_SERVICE_URL || 'http://localhost:9000',
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  // The path will be /peerjs/peerjs on the proxy, forward as-is to target
  onProxyReqWs: (proxyReq, req, socket) => {
    console.log(' WebSocket upgrade - PeerJS:', req.url);
    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  },
  onError: (err, req, res) => {
    console.error('Error proxying PeerJS:', err.message);
  },
});

app.use('/peerjs', peerJsProxy);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    availableRoutes: ['/auth', '/api/realtime', '/realtime/health', '/socket.io', '/peerjs', '/health']
  });
});

// Create HTTP server
const server = http.createServer(app);

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  console.log(' Upgrade request for:', req.url);
  
  if (req.url.startsWith('/socket.io')) {
    console.log(' Upgrading Socket.IO connection');
    socketIoProxy.upgrade(req, socket, head);
  } else if (req.url.startsWith('/peerjs')) {
    console.log(' Upgrading PeerJS connection');
    peerJsProxy.upgrade(req, socket, head);
  } else {
    console.warn('️ Unknown upgrade path:', req.url);
    socket.destroy();
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log(` Auth Service: ${process.env.AUTH_SERVICE_URL || 'http://localhost:3003'}`);
  console.log(` Realtime Service: ${process.env.REALTIME_SERVICE_URL || 'http://localhost:3001'}`);
  console.log(` Peer Service: ${process.env.PEER_SERVICE_URL || 'http://localhost:9000'}`);
});

module.exports = server;