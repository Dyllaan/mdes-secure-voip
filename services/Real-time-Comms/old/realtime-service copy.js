const express = require('express');
const http = require('http');
const https = require('https');
const socketIO = require('socket.io');
const { PeerServer } = require('peer');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();

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
    apiRateLimitMax: 100 // 100 requests per 15 minutes
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

class SecureRealtimeService {
  constructor() {
    this.config = config.services.realtime;
    
    // Express app for HTTP endpoints
    this.app = express();
    this.server = this.createServer();
    
    // Socket.IO for real-time communication
    this.io = socketIO(this.server, {
      cors: config.cors,
      pingTimeout: 60000,
      pingInterval: 25000
    });
    
    // PeerJS server for WebRTC
    this.peerServer = PeerServer({
      port: this.config.peerPort,
      path: '/peerjs',
      allow_discovery: false, // Disable for security
      proxied: true,
      corsOptions: config.cors,
      key: 'peerjs',
      generateClientId: () => {
        // Generate secure client IDs server-side
        return crypto.randomBytes(16).toString('hex');
      }
    });

    // State management
    this.rooms = new Map(); // roomId -> room state
    this.users = new Map(); // socketId -> user info
    this.socketRateLimits = new Map(); // rate limiting per socket
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.startCleanupInterval();
  }

  createServer() {
    if (process.env.NODE_ENV === 'production' && process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
      try {
        const options = {
          key: fs.readFileSync(process.env.SSL_KEY_PATH),
          cert: fs.readFileSync(process.env.SSL_CERT_PATH)
        };
        console.log(' HTTPS server enabled');
        return https.createServer(options, this.app);
      } catch (error) {
        console.warn('️  Failed to load SSL certificates, falling back to HTTP:', error.message);
        return http.createServer(this.app);
      }
    }
    return http.createServer(this.app);
  }

  setupMiddleware() {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", ...config.cors.origin]
        }
      }
    }));

    this.app.use(cors(config.cors));
    this.app.use(express.json({ limit: '10kb' })); // Limit payload size

    // API rate limiting
    const apiLimiter = rateLimit({
      windowMs: config.security.apiRateLimitWindow,
      max: config.security.apiRateLimitMax,
      message: { error: 'Too many requests, please try again later' },
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use(apiLimiter);

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  setupRoutes() {
    // Health check (no auth required)
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        services: ['signaling', 'voip', 'media-sync', 'chat'],
        activeRooms: this.rooms.size,
        activeUsers: this.users.size,
        timestamp: new Date().toISOString()
      });
    });

    // Protected routes - require authentication
    this.app.use('/api', this.authenticateRequest.bind(this));

    // Room management
    this.app.get('/api/rooms', (req, res) => {
      // Return all rooms (no permission filtering needed)
      const accessibleRooms = Array.from(this.rooms.entries())
        .map(([id, room]) => ({
          id,
          userCount: room.users.size,
          hasHost: !!room.mediaHost,
          currentVideo: room.currentVideo ? {
            videoId: room.currentVideo.videoId,
            isPlaying: room.currentVideo.isPlaying
          } : null
        }));

      res.json({ rooms: accessibleRooms });
    });

    this.app.post('/api/rooms', (req, res) => {
      const userId = req.userId;
      const { roomId } = req.body;

      // Validate room ID
      if (roomId && !this.isValidRoomId(roomId)) {
        return res.status(400).json({ error: 'Invalid room ID format' });
      }

      const finalRoomId = roomId || this.generateRoomId();
      
      if (!this.rooms.has(finalRoomId)) {
        this.createRoom(finalRoomId, userId);
        res.json({ roomId: finalRoomId, created: true });
      } else {
        res.json({ roomId: finalRoomId, created: false });
      }
    });

    this.app.delete('/api/rooms/:roomId', (req, res) => {
      const { roomId } = req.params;
      const userId = req.userId;

      const room = this.rooms.get(roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }

      // Only room creator can delete
      if (room.createdBy !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Disconnect all users
      this.io.to(roomId).emit('room-closed', { message: 'Room has been closed by host' });
      this.rooms.delete(roomId);
      this.roomPermissions.delete(roomId);

      res.json({ success: true });
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  authenticateRequest(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      req.userId = decoded.userId;
      req.username = decoded.username;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  setupSocketHandlers() {
    // Socket.IO authentication middleware
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        socket.userId = decoded.userId;
        socket.username = decoded.username;
        console.log(`Socket authenticated: ${socket.id} (User: ${decoded.username})`);
        next();
      } catch (err) {
        console.log(`Socket authentication failed: ${err.message}`);
        return next(new Error('Invalid or expired token'));
      }
    });

    this.io.on('connection', (socket) => {
      console.log(` User connected: ${socket.id} (${socket.username})`);
      
      // Initialize rate limit tracking for this socket
      this.socketRateLimits.set(socket.id, new Map());

      // Generate and send peer ID immediately after authentication
      const peerId = this.generateSecurePeerId(socket.userId);
      socket.peerId = peerId;
      socket.emit('peer-assigned', { peerId });
      console.log(` Assigned peer ID to ${socket.username}: ${peerId}`);

      // Authentication/Room joining
      socket.on('join-room', (data) => {
        if (this.checkSocketRateLimit(socket, 'join-room', 5, 60000)) {
          this.handleJoinRoom(socket, data);
        }
      });
      
      // WebRTC signaling
      socket.on('webrtc-offer', (data) => {
        if (this.checkSocketRateLimit(socket, 'webrtc-offer')) {
          this.handleWebRTCOffer(socket, data);
        }
      });

      socket.on('webrtc-answer', (data) => {
        if (this.checkSocketRateLimit(socket, 'webrtc-answer')) {
          this.handleWebRTCAnswer(socket, data);
        }
      });

      socket.on('webrtc-ice-candidate', (data) => {
        if (this.checkSocketRateLimit(socket, 'webrtc-ice-candidate')) {
          this.handleWebRTCIceCandidate(socket, data);
        }
      });
      
      // Chat
      socket.on('chat-message', (data) => {
        if (this.checkSocketRateLimit(socket, 'chat-message', 10, 10000)) {
          this.handleChatMessage(socket, data);
        }
      });
      
      // Media sync
      socket.on('media-load', (data) => {
        if (this.checkSocketRateLimit(socket, 'media-load', 10, 60000)) {
          this.handleMediaLoad(socket, data);
        }
      });

      socket.on('media-play', (data) => {
        if (this.checkSocketRateLimit(socket, 'media-play', 30, 60000)) {
          this.handleMediaPlay(socket, data);
        }
      });

      socket.on('media-pause', (data) => {
        if (this.checkSocketRateLimit(socket, 'media-pause', 30, 60000)) {
          this.handleMediaPause(socket, data);
        }
      });

      socket.on('media-seek', (data) => {
        if (this.checkSocketRateLimit(socket, 'media-seek', 30, 60000)) {
          this.handleMediaSeek(socket, data);
        }
      });

      socket.on('media-sync-request', () => {
        if (this.checkSocketRateLimit(socket, 'media-sync-request', 20, 10000)) {
          this.handleMediaSyncRequest(socket);
        }
      });
      
      // User management
      socket.on('user-update', (data) => {
        if (this.checkSocketRateLimit(socket, 'user-update', 5, 60000)) {
          this.handleUserUpdate(socket, data);
        }
      });

      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  // Rate limiting for socket events
  checkSocketRateLimit(socket, action, max = config.security.socketRateLimitMax, windowMs = config.security.socketRateLimitWindow) {
    const socketLimits = this.socketRateLimits.get(socket.id);
    if (!socketLimits) return false;

    const now = Date.now();
    const actionLimit = socketLimits.get(action) || { count: 0, resetAt: now + windowMs };

    if (now > actionLimit.resetAt) {
      actionLimit.count = 0;
      actionLimit.resetAt = now + windowMs;
    }

    actionLimit.count++;
    socketLimits.set(action, actionLimit);

    if (actionLimit.count > max) {
      socket.emit('rate-limit-exceeded', { 
        action,
        message: 'Too many requests, please slow down',
        retryAfter: actionLimit.resetAt - now
      });
      return false;
    }

    return true;
  }

  handleJoinRoom(socket, data) {
    const { roomId, alias } = data;

    // Validate inputs
    if (!roomId || !this.isValidRoomId(roomId)) {
      return socket.emit('join-error', { message: 'Invalid room ID' });
    }

    if (!alias || typeof alias !== 'string' || alias.length > config.security.maxAliasLength) {
      return socket.emit('join-error', { message: 'Invalid alias' });
    }

    // Leave any existing room
    if (socket.roomId) {
      this.leaveRoom(socket, socket.roomId);
    }

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.createRoom(roomId, socket.userId);
    }

    const room = this.rooms.get(roomId);
    
    // Use the peer ID that was already assigned on connection
    const peerId = socket.peerId;
    
    // Add user to room
    socket.join(roomId);
    socket.roomId = roomId;
    socket.alias = this.sanitizeInput(alias);
    
    const userInfo = { 
      socketId: socket.id, 
      peerId, 
      alias: socket.alias,
      userId: socket.userId,
      username: socket.username,
      joinedAt: Date.now()
    };
    
    room.users.set(socket.id, userInfo);
    this.users.set(socket.id, { ...userInfo, roomId });

    // Get existing users
    const existingUsers = Array.from(room.users.values())
      .filter(user => user.socketId !== socket.id)
      .map(user => ({ peerId: user.peerId, alias: user.alias }));

    // Send existing users to new joiner (peer-assigned already sent on connection)
    socket.emit('all-users', existingUsers);
    
    // Notify existing users about new joiner
    socket.to(roomId).emit('user-connected', { peerId, alias: socket.alias });

    console.log(`User ${socket.username} joined room ${roomId} with alias: ${socket.alias}`);
  }

  handleMediaLoad(socket, data) {
    const { videoId } = data;
    const room = this.rooms.get(socket.roomId);
    
    if (!room) {
      return socket.emit('media-error', { message: 'Not in a room' });
    }

    // Validate video ID
    if (!videoId || typeof videoId !== 'string' || videoId.length > 100) {
      return socket.emit('media-error', { message: 'Invalid video ID' });
    }

    // Only allow host to load media, or first user if no host
    if (!room.mediaHost) {
      room.mediaHost = socket.id;
    }
    
    if (room.mediaHost !== socket.id) {
      return socket.emit('media-error', { message: 'Only host can load media' });
    }

    room.currentVideo = {
      videoId: this.sanitizeInput(videoId),
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      host: socket.id
    };

    this.io.to(socket.roomId).emit('media-loaded', { 
      videoId: room.currentVideo.videoId, 
      host: socket.id 
    });
  }

  handleMediaPlay(socket, data) {
    const { currentTime } = data;
    const room = this.rooms.get(socket.roomId);
    
    if (!room?.currentVideo) {
      return socket.emit('media-error', { message: 'No media loaded' });
    }

    if (room.mediaHost !== socket.id) {
      return socket.emit('media-error', { message: 'Only host can control playback' });
    }

    if (typeof currentTime !== 'number' || currentTime < 0) {
      return socket.emit('media-error', { message: 'Invalid time value' });
    }

    room.currentVideo.currentTime = currentTime;
    room.currentVideo.isPlaying = true;
    room.currentVideo.lastUpdate = Date.now();

    socket.to(socket.roomId).emit('media-play', {
      currentTime,
      serverTime: room.currentVideo.lastUpdate
    });
  }

  handleMediaPause(socket, data) {
    const { currentTime } = data;
    const room = this.rooms.get(socket.roomId);
    
    if (!room?.currentVideo) {
      return socket.emit('media-error', { message: 'No media loaded' });
    }

    if (room.mediaHost !== socket.id) {
      return socket.emit('media-error', { message: 'Only host can control playback' });
    }

    if (typeof currentTime !== 'number' || currentTime < 0) {
      return socket.emit('media-error', { message: 'Invalid time value' });
    }

    room.currentVideo.currentTime = currentTime;
    room.currentVideo.isPlaying = false;
    room.currentVideo.lastUpdate = Date.now();

    socket.to(socket.roomId).emit('media-pause', {
      currentTime,
      serverTime: room.currentVideo.lastUpdate
    });
  }

  handleMediaSeek(socket, data) {
    const { newTime } = data;
    const room = this.rooms.get(socket.roomId);
    
    if (!room?.currentVideo) {
      return socket.emit('media-error', { message: 'No media loaded' });
    }

    if (room.mediaHost !== socket.id) {
      return socket.emit('media-error', { message: 'Only host can control playback' });
    }

    if (typeof newTime !== 'number' || newTime < 0) {
      return socket.emit('media-error', { message: 'Invalid time value' });
    }

    room.currentVideo.currentTime = newTime;
    room.currentVideo.lastUpdate = Date.now();

    socket.to(socket.roomId).emit('media-seek', {
      newTime,
      serverTime: room.currentVideo.lastUpdate
    });
  }

  handleMediaSyncRequest(socket) {
    const room = this.rooms.get(socket.roomId);
    
    if (!room?.currentVideo) {
      return socket.emit('media-sync', { noMedia: true });
    }

    socket.emit('media-sync', {
      videoId: room.currentVideo.videoId,
      currentTime: this.calculateCurrentTime(room),
      isPlaying: room.currentVideo.isPlaying,
      serverTime: Date.now()
    });
  }

  handleChatMessage(socket, data) {
    const { message } = data;
    const user = this.users.get(socket.id);
    
    if (!user) {
      return socket.emit('chat-error', { message: 'Not authenticated' });
    }

    // Validate message
    if (!message || typeof message !== 'string') {
      return socket.emit('chat-error', { message: 'Invalid message' });
    }

    if (message.length > config.security.maxMessageLength) {
      return socket.emit('chat-error', { 
        message: `Message too long (max ${config.security.maxMessageLength} characters)` 
      });
    }

    const sanitizedMessage = this.sanitizeInput(message);

    if (!sanitizedMessage.trim()) {
      return socket.emit('chat-error', { message: 'Empty message' });
    }

    const chatMessage = {
      id: crypto.randomBytes(8).toString('hex'),
      sender: user.peerId,
      alias: user.alias,
      message: sanitizedMessage,
      timestamp: new Date().toISOString()
    };

    // Broadcast to room (excluding sender - they already have it locally)
    socket.to(user.roomId).emit('chat-message', chatMessage);
  }

  // WebRTC signaling handlers
  handleWebRTCOffer(socket, data) {
    const { targetPeerId, offer } = data;
    
    if (!targetPeerId || !offer) {
      return socket.emit('webrtc-error', { message: 'Invalid offer data' });
    }

    const targetSocket = this.findSocketByPeerId(targetPeerId);
    
    if (!targetSocket) {
      return socket.emit('webrtc-error', { message: 'Target peer not found' });
    }

    // Verify both users are in the same room
    if (socket.roomId !== targetSocket.roomId) {
      return socket.emit('webrtc-error', { message: 'Users not in same room' });
    }

    targetSocket.emit('webrtc-offer', {
      fromPeerId: socket.peerId,
      offer
    });
  }

  handleWebRTCAnswer(socket, data) {
    const { targetPeerId, answer } = data;
    
    if (!targetPeerId || !answer) {
      return socket.emit('webrtc-error', { message: 'Invalid answer data' });
    }

    const targetSocket = this.findSocketByPeerId(targetPeerId);
    
    if (!targetSocket) {
      return socket.emit('webrtc-error', { message: 'Target peer not found' });
    }

    // Verify both users are in the same room
    if (socket.roomId !== targetSocket.roomId) {
      return socket.emit('webrtc-error', { message: 'Users not in same room' });
    }

    targetSocket.emit('webrtc-answer', {
      fromPeerId: socket.peerId,
      answer
    });
  }

  handleWebRTCIceCandidate(socket, data) {
    const { targetPeerId, candidate } = data;
    
    if (!targetPeerId || !candidate) {
      return socket.emit('webrtc-error', { message: 'Invalid ICE candidate data' });
    }

    const targetSocket = this.findSocketByPeerId(targetPeerId);
    
    if (!targetSocket) {
      return socket.emit('webrtc-error', { message: 'Target peer not found' });
    }

    // Verify both users are in the same room
    if (socket.roomId !== targetSocket.roomId) {
      return socket.emit('webrtc-error', { message: 'Users not in same room' });
    }

    targetSocket.emit('webrtc-ice-candidate', {
      fromPeerId: socket.peerId,
      candidate
    });
  }

  handleUserUpdate(socket, data) {
    const { alias } = data;
    const user = this.users.get(socket.id);
    
    if (!user) return;

    // Validate alias
    if (!alias || typeof alias !== 'string' || alias.length > config.security.maxAliasLength) {
      return socket.emit('user-error', { message: 'Invalid alias' });
    }

    const sanitizedAlias = this.sanitizeInput(alias);
    
    user.alias = sanitizedAlias;
    socket.alias = sanitizedAlias;
    
    const room = this.rooms.get(user.roomId);
    if (room) {
      room.users.get(socket.id).alias = sanitizedAlias;
      socket.to(user.roomId).emit('user-updated', {
        peerId: user.peerId,
        alias: sanitizedAlias
      });
    }
  }

  handleDisconnect(socket) {
    console.log(` Client disconnected: ${socket.id} (${socket.username})`);
    
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
      this.leaveRoom(socket, socket.roomId);
    }
    
    this.users.delete(socket.id);
    this.socketRateLimits.delete(socket.id);
  }

  // Helper methods
  createRoom(roomId, createdBy) {
    this.rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      mediaHost: null,
      currentVideo: null,
      createdBy,
      createdAt: Date.now()
    });

    console.log(` Room created: ${roomId} by user ${createdBy}`);
  }

  leaveRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.users.delete(socket.id);
    socket.leave(roomId);
    socket.to(roomId).emit('user-left', { 
      socketId: socket.id, 
      peerId: socket.peerId 
    });

    // Transfer host if needed
    if (room.mediaHost === socket.id && room.users.size > 0) {
      const newHost = room.users.values().next().value;
      room.mediaHost = newHost.socketId;
      this.io.to(roomId).emit('media-host-changed', { 
        newHost: newHost.peerId 
      });
    }

    // Clean up empty rooms
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
      console.log(`️  Room deleted: ${roomId} (empty)`);
    }
  }

  findSocketByPeerId(peerId) {
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.peerId === peerId) {
        return socket;
      }
    }
    return null;
  }

  calculateCurrentTime(room) {
    if (!room.currentVideo) return 0;
    
    const { currentTime, isPlaying, lastUpdate } = room.currentVideo;
    if (!isPlaying) return currentTime;
    
    const elapsed = (Date.now() - lastUpdate) / 1000;
    return currentTime + elapsed;
  }

  generateRoomId() {
    // Generate cryptographically secure room ID
    return crypto.randomBytes(6).toString('base64url');
  }

  generateSecurePeerId(userId) {
    // Generate unique peer ID combining user ID with random data
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${userId}-${timestamp}-${random}`;
  }

  sanitizeInput(input) {
    // Remove any HTML/script tags and trim
    return input
      .replace(/<[^>]*>/g, '')
      .replace(/[<>'"]/g, '')
      .trim();
  }

  isValidRoomId(roomId) {
    // Allow alphanumeric, hyphens, underscores, up to max length
    const pattern = new RegExp(`^[a-zA-Z0-9_-]{1,${config.security.maxRoomIdLength}}$`);
    return pattern.test(roomId);
  }

  canUserAccessRoom(userId, roomId) {
    // If room doesn't exist yet, allow creation
    if (!this.rooms.has(roomId)) {
      return true;
    }

    // Check if user has permission to access this room
    const permissions = this.roomPermissions.get(roomId);
    if (!permissions) {
      // If no permissions set, allow access (backward compatibility)
      return true;
    }

    return permissions.has(userId);
  }

  grantRoomAccess(roomId, userId) {
    if (!this.roomPermissions.has(roomId)) {
      this.roomPermissions.set(roomId, new Set());
    }
    this.roomPermissions.get(roomId).add(userId);
  }

  revokeRoomAccess(roomId, userId) {
    const permissions = this.roomPermissions.get(roomId);
    if (permissions) {
      permissions.delete(userId);
    }
  }

  startCleanupInterval() {
    // Clean up stale rate limit data every 5 minutes
    setInterval(() => {
      const now = Date.now();
      
      // Clean up socket rate limits for disconnected sockets
      for (const [socketId, limits] of this.socketRateLimits.entries()) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) {
          this.socketRateLimits.delete(socketId);
        }
      }

      // Clean up old rooms (optional - rooms older than 24 hours with no users)
      for (const [roomId, room] of this.rooms.entries()) {
        const ageHours = (now - room.createdAt) / (1000 * 60 * 60);
        if (room.users.size === 0 && ageHours > 24) {
          this.rooms.delete(roomId);
          console.log(`️  Cleaned up old room: ${roomId}`);
        }
      }

      console.log(`Cleanup: ${this.rooms.size} rooms, ${this.users.size} users`);
    }, 5 * 60 * 1000);
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        console.log(` Secure Realtime service running on port ${this.config.port}`);
        console.log(` PeerJS server running on port ${this.config.peerPort}`);
        console.log(` Security features enabled:`);
        console.log(`   - JWT Authentication`);
        console.log(`   - Rate Limiting`);
        console.log(`   - Input Validation`);
        console.log(`   - Helmet Security Headers`);
        console.log(`   - CORS Protection`);
        resolve();
      });
    });
  }

  shutdown() {
    console.log(' Shutting down server...');
    
    // Notify all connected clients
    this.io.emit('server-shutdown', { 
      message: 'Server is shutting down for maintenance' 
    });

    // Close all connections
    this.io.close(() => {
      console.log('Socket.IO server closed');
    });

    this.server.close(() => {
      console.log('HTTP server closed');
    });
  }
}

module.exports = SecureRealtimeService;

// Start the service if this file is run directly
if (require.main === module) {
  async function start() {
    try {
      console.log(' Starting Secure Real-time Communications Service...');
      
      const service = new SecureRealtimeService();
      await service.start();
      
      console.log('Service started successfully!');
      console.log(` Socket.IO server: ${process.env.NODE_ENV === 'production' ? 'wss' : 'ws'}://localhost:${process.env.REALTIME_PORT || 3001}`);
      console.log(` PeerJS server: ${process.env.NODE_ENV === 'production' ? 'wss' : 'ws'}://localhost:${process.env.PEER_PORT || 9000}`);
      console.log(` Health check: http://localhost:${process.env.REALTIME_PORT || 3001}/health`);
      
    } catch (error) {
      console.error('Failed to start service:', error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  let isShuttingDown = false;
  
  const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n Received ${signal}, shutting down gracefully...`);
    
    // Give connections time to close
    setTimeout(() => {
      console.log('Shutdown complete');
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  start();
}