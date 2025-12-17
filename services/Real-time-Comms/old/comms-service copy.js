const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { PeerServer } = require('peer');
const cors = require('cors');


const config = {
  services: {
    realtime: {
      port: process.env.REALTIME_PORT || 3001,
      peerPort: process.env.PEER_PORT || 9000
    }
  },
  cors: {
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173", // Vite default
      "http://localhost:8080"  // Common dev server port
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
};

class RealtimeService {
  constructor() {
    this.config = config.services.realtime;
    
    // Express app for HTTP endpoints
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Socket.IO for real-time communication
    this.io = socketIO(this.server, {
      cors: config.cors
    });
    
    // PeerJS server for WebRTC
    this.peerServer = PeerServer({
      port: this.config.peerPort,
      path: '/peerjs',
      allow_discovery: true,
      proxied: true,
      corsOptions: config.cors
    });

    // State management
    this.rooms = new Map(); // roomId -> room state
    this.users = new Map(); // socketId -> user info
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  setupMiddleware() {
    this.app.use(cors(config.cors));
    this.app.use(express.json());
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        services: ['signaling', 'voip', 'media-sync', 'chat'],
        activeRooms: this.rooms.size,
        activeUsers: this.users.size
      });
    });

    // Room management
    this.app.get('/rooms', (req, res) => {
      const roomList = Array.from(this.rooms.entries()).map(([id, room]) => ({
        id,
        userCount: room.users.size,
        hasHost: !!room.mediaHost,
        currentVideo: room.currentVideo
      }));
      res.json({ rooms: roomList });
    });

    this.app.post('/rooms', (req, res) => {
      const roomId = req.body.roomId || this.generateRoomId();
      if (!this.rooms.has(roomId)) {
        this.createRoom(roomId);
        res.json({ roomId, created: true });
      } else {
        res.json({ roomId, created: false });
      }
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);
      
      // Authentication/Room joining
      socket.on('join-room', this.handleJoinRoom.bind(this, socket));
      
      // WebRTC signaling (consolidated)
      socket.on('webrtc-offer', this.handleWebRTCOffer.bind(this, socket));
      socket.on('webrtc-answer', this.handleWebRTCAnswer.bind(this, socket));
      socket.on('webrtc-ice-candidate', this.handleWebRTCIceCandidate.bind(this, socket));
      
      // Chat
      socket.on('chat-message', this.handleChatMessage.bind(this, socket));
      
      // Media sync
      socket.on('media-load', this.handleMediaLoad.bind(this, socket));
      socket.on('media-play', this.handleMediaPlay.bind(this, socket));
      socket.on('media-pause', this.handleMediaPause.bind(this, socket));
      socket.on('media-seek', this.handleMediaSeek.bind(this, socket));
      socket.on('media-sync-request', this.handleMediaSyncRequest.bind(this, socket));
      
      // User management
      socket.on('user-update', this.handleUserUpdate.bind(this, socket));
      socket.on('disconnect', this.handleDisconnect.bind(this, socket));
    });
  }

  handleJoinRoom(socket, { peerId, alias }) {
    const roomId = "default-room"; // Force default room to match old service
    
    // Leave any existing room
    if (socket.roomId) {
      this.leaveRoom(socket, socket.roomId);
    }

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.createRoom(roomId);
    }

    const room = this.rooms.get(roomId);
    
    // Add user to room
    socket.join(roomId);
    socket.roomId = roomId;
    socket.peerId = peerId;
    socket.alias = alias;
    
    const userInfo = { socketId: socket.id, peerId, alias };
    room.users.set(socket.id, userInfo);
    this.users.set(socket.id, { ...userInfo, roomId });

    // Get existing users BEFORE notifying them (to match old service behavior)
    const existingUsers = Array.from(room.users.values())
      .filter(user => user.socketId !== socket.id)
      .map(user => ({ peerId: user.peerId, alias: user.alias }));

    // Send existing users to new joiner (match old service event name)
    socket.emit('all-users', existingUsers);
    
    // Notify existing users about new joiner (match old service event name)
    socket.to(roomId).emit('user-connected', { peerId, alias });

    console.log(`Peer ${peerId} joined ${roomId} with alias: ${alias}.`);
  }

  handleMediaLoad(socket, { videoId }) {
    const room = this.rooms.get(socket.roomId);
    if (!room) return;

    // Only allow host to load media, or first user if no host
    if (!room.mediaHost) {
      room.mediaHost = socket.id;
    }
    
    if (room.mediaHost !== socket.id) {
      return socket.emit('media-error', { message: 'Only host can load media' });
    }

    room.currentVideo = {
      videoId,
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      host: socket.id
    };

    this.io.to(socket.roomId).emit('media-loaded', { 
      videoId, 
      host: socket.id 
    });
  }

  handleMediaPlay(socket, { currentTime }) {
    const room = this.rooms.get(socket.roomId);
    if (!room?.currentVideo || room.mediaHost !== socket.id) return;

    room.currentVideo.currentTime = currentTime;
    room.currentVideo.isPlaying = true;
    room.currentVideo.lastUpdate = Date.now();

    socket.to(socket.roomId).emit('media-play', {
      currentTime,
      serverTime: room.currentVideo.lastUpdate
    });
  }

  handleMediaPause(socket, { currentTime }) {
    const room = this.rooms.get(socket.roomId);
    if (!room?.currentVideo || room.mediaHost !== socket.id) return;

    room.currentVideo.currentTime = currentTime;
    room.currentVideo.isPlaying = false;
    room.currentVideo.lastUpdate = Date.now();

    socket.to(socket.roomId).emit('media-pause', {
      currentTime,
      serverTime: room.currentVideo.lastUpdate
    });
  }

  handleMediaSeek(socket, { newTime }) {
    const room = this.rooms.get(socket.roomId);
    if (!room?.currentVideo || room.mediaHost !== socket.id) return;

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

  handleChatMessage(socket, { message }) {
    const user = this.users.get(socket.id);
    if (!user) return;

    const chatMessage = {
      id: Date.now(),
      sender: user.peerId,
      alias: user.alias,
      message,
      timestamp: new Date().toISOString()
    };

    socket.to(user.roomId).emit('chat-message', chatMessage);
  }

  // WebRTC signaling handlers
  handleWebRTCOffer(socket, { targetPeerId, offer }) {
    const targetSocket = this.findSocketByPeerId(targetPeerId);
    if (targetSocket) {
      targetSocket.emit('webrtc-offer', {
        fromPeerId: socket.peerId,
        offer
      });
    }
  }

  handleWebRTCAnswer(socket, { targetPeerId, answer }) {
    const targetSocket = this.findSocketByPeerId(targetPeerId);
    if (targetSocket) {
      targetSocket.emit('webrtc-answer', {
        fromPeerId: socket.peerId,
        answer
      });
    }
  }

  handleWebRTCIceCandidate(socket, { targetPeerId, candidate }) {
    const targetSocket = this.findSocketByPeerId(targetPeerId);
    if (targetSocket) {
      targetSocket.emit('webrtc-ice-candidate', {
        fromPeerId: socket.peerId,
        candidate
      });
    }
  }

  // Helper methods
  createRoom(roomId) {
    this.rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      mediaHost: null,
      currentVideo: null,
      createdAt: Date.now()
    });
  }

  leaveRoom(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.users.delete(socket.id);
    socket.to(roomId).emit('user-left', { socketId: socket.id, peerId: socket.peerId });

    // Transfer host if needed
    if (room.mediaHost === socket.id && room.users.size > 0) {
      const newHost = room.users.values().next().value;
      room.mediaHost = newHost.socketId;
      this.io.to(roomId).emit('media-host-changed', { newHost: newHost.peerId });
    }

    // Clean up empty rooms
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
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
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  handleUserUpdate(socket, { alias }) {
    const user = this.users.get(socket.id);
    if (user) {
      user.alias = alias;
      socket.alias = alias;
      
      const room = this.rooms.get(user.roomId);
      if (room) {
        room.users.get(socket.id).alias = alias;
        socket.to(user.roomId).emit('user-updated', {
          peerId: user.peerId,
          alias
        });
      }
    }
  }


  handleDisconnect(socket) {
    console.log(`Client disconnected: ${socket.peerId}`);
    
    if (socket.roomId) {
      // Notify room about disconnection (match old service event name)
      socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
      this.leaveRoom(socket, socket.roomId);
    }
    
    this.users.delete(socket.id);
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        console.log(`Realtime service running on port ${this.config.port}`);
        console.log(`PeerJS server running on port ${this.config.peerPort}`);
        resolve();
      });
    });
  }
}

module.exports = RealtimeService;

// Start the service if this file is run directly
if (require.main === module) {
  async function start() {
    try {
      console.log(' Starting Real-time Communications Service...');
      
      const service = new RealtimeService();
      await service.start();
      
      console.log('Service started successfully!');
      console.log(' Socket.IO server: http://localhost:3001');
      console.log(' PeerJS server: http://localhost:9000');
      console.log(' Health check: http://localhost:3001/health');
      
    } catch (error) {
      console.error('Failed to start service:', error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n Shutting down gracefully...');
    process.exit(0);
  });

  start();
}