const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RoomManager = require('../room/RoomManager');
const SignalProtocolHandler = require('./SignalProtocolHandler');
const RoomKeyHandler = require('./RoomKeyHandler');
const WebRTCHandler = require('./WebRTCHandler');
const ChatHandler = require('./ChatHandler');
const UserHandler = require('./UserHandler');

class SocketEventHandlers {
    constructor(service) {
        this.service = service;
        this.config = service.config;
        this.io = service.io;
        this.socketRateLimits = new Map();

        this.signalKeys = new Map();
        this.messageQueues = new Map();
        this.rsaPublicKeys = new Map();

        this.roomManager = new RoomManager(this.config, this.io);

        this.signal = new SignalProtocolHandler(this);
        this.roomKey = new RoomKeyHandler(this);
        this.webrtc = new WebRTCHandler(this);
        this.chat = new ChatHandler(this);
        this.user = new UserHandler(this);
    }

    setup() {
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token;
            if (!token) return next(new Error('Authentication required'));
            try {
                const secret = Buffer.from(this.config.jwt.secret, 'base64');
                const decoded = jwt.verify(token, secret);
                socket.userId = decoded.sub;
                socket.username = socket.handshake.auth.username;
                socket.token = token;
                console.log(`Socket authenticated: ${socket.id} (User: ${socket.username})`);
                next();
            } catch (err) {
                console.log(`Socket authentication failed: ${err.message}`);
                return next(new Error('Invalid or expired token'));
            }
        });
        this.io.on('connection', (socket) => {
            console.log(`User connected: ${socket.id} (${socket.username})`);

            this.socketRateLimits.set(socket.id, new Map());

            const peerId = this.generateSecurePeerId(socket.username);
            socket.peerId = peerId;
            socket.emit('peer-assigned', { peerId });
            console.log(`Assigned peer ID to ${socket.username}: ${peerId}`);

            const rooms = Array.from(this.roomManager.rooms.entries()).map(([id, room]) => ({
                id,
                userCount: room.users.size,
                createdBy: room.createdBy,
            }));
            socket.emit('room-list', { rooms });

            const rl = (action, max, window) =>
                this.checkSocketRateLimit(socket, action, max, window);

            // User / room
            socket.on('join-room',               (d) => rl('join-room', 5, 60000)    && this.user.handleJoinRoom(socket, d));
            socket.on('user-update',             (d) => rl('user-update', 5, 60000)  && this.user.handleUserUpdate(socket, d));

            // Screen share
            socket.on('request-screen-peer-id',  ()  => rl('screen-peer', 5, 60000) && this.user.handleRequestScreenPeerId(socket));
            socket.on('screenshare-started',     (d) => rl('screenshare', 10, 10000) && this.user.handleScreenshareStarted(socket, d));
            socket.on('screenshare-stopped',     (d) => rl('screenshare', 10, 10000) && this.user.handleScreenshareStopped(socket, d));

            // WebRTC
            socket.on('webrtc-offer',            (d) => rl('webrtc-offer')           && this.webrtc.handleOffer(socket, d));
            socket.on('webrtc-answer',           (d) => rl('webrtc-answer')          && this.webrtc.handleAnswer(socket, d));
            socket.on('webrtc-ice-candidate',    (d) => rl('webrtc-ice-candidate')   && this.webrtc.handleIceCandidate(socket, d));

            // Signal Protocol
            socket.on('signal-register-keys',    (d) => rl('signal-register-keys', 5, 60000)     && this.signal.handleRegisterKeys(socket, d));
            socket.on('signal-request-bundle',   (d) => rl('signal-request-bundle', 30, 60000)   && this.signal.handleRequestBundle(socket, d));
            socket.on('signal-refresh-prekeys',  (d) => rl('signal-refresh-prekeys', 10, 300000) && this.signal.handleRefreshPrekeys(socket, d));

            // Room key / RSA
            socket.on('register-rsa-key',        (d) => rl('register-rsa-key', 5, 60000)   && this.roomKey.handleRegisterRSAKey(socket, d));
            socket.on('request-rsa-key',         (d) => rl('request-rsa-key', 30, 60000)   && this.roomKey.handleRequestRSAKey(socket, d));
            socket.on('request-room-key',        (d) => rl('request-room-key', 5, 60000)   && this.roomKey.handleRoomKeyRequest(socket, d));
            socket.on('room-key-response',       (d) => rl('room-key-response', 10, 60000) && this.roomKey.handleRoomKeyResponse(socket, d));

            // Chat
            socket.on('encrypted-chat-message',  (d) => rl('encrypted-chat-message', 10, 10000) && this.chat.handleEncryptedMessage(socket, d));
            socket.on('room-chat-message',       (d) => rl('room-chat-message', 10, 10000)       && this.chat.handleRoomMessage(socket, d));

            // Persistent channel socket events
            socket.on('channel-message-sent', (d) => rl('channel-message-sent', 30, 10000) && socket.broadcast.emit('channel-message-sent', d));

            // Hub room membership — client calls these when entering/leaving a hub view
            socket.on('hub:join', (hubId) => {
                if (typeof hubId !== 'string' || !hubId) return;
                socket.join(`hub:${hubId}`);
            });
            socket.on('hub:leave', (hubId) => {
                if (typeof hubId !== 'string' || !hubId) return;
                socket.leave(`hub:${hubId}`);
            });

            // Channel lifecycle notifications - tells all connected members to refresh their channel list
            // Payload: { hubId, channelId, channelName?, channelType? }
            socket.on('channel-created', (d) => rl('channel-created', 5, 60000) && socket.to(`hub:${d.hubId}`).emit('channel-created', d));
            socket.on('channel-deleted', (d) => rl('channel-deleted', 5, 60000) && socket.to(`hub:${d.hubId}`).emit('channel-deleted', d));

            // Member lifecycle notifications - tells all connected members to refresh member list
            // Payload: { hubId, userId? }
            socket.on('member-joined',   (d) => rl('member-joined',   5, 60000) && socket.to(`hub:${d.hubId}`).emit('member-joined', d));

            // Channel key rotation notification - tells all connected members to sync new key bundles
            // Payload: { hubId, channelId, newVersion }
            socket.on('channel-key-rotated', (d) => rl('channel-key-rotated', 5, 60000) && socket.to(`hub:${d.hubId}`).emit('channel-key-rotated', d));

            // Musicman bot events — relay to the voice room identified in the payload.
            // Using io.to() rather than socket.to() so delivery is not gated on
            // socket.roomId being set (which requires checkChannelAccess to succeed).
            socket.on('musicman:track-changed', (d) => {
                if (d?.roomId) this.io.to(d.roomId).emit('musicman:track-changed', d);
            });
            socket.on('musicman:track-ended', (d) => {
                if (d?.roomId) this.io.to(d.roomId).emit('musicman:track-ended', d);
            });
            socket.on('musicman:state-changed', (d) => {
                if (d?.roomId) this.io.to(d.roomId).emit('musicman:state-changed', d);
            });

            socket.on('disconnect', () => this.handleDisconnect(socket));
        });
    }

    checkSocketRateLimit(socket, action, max = this.config.security.socketRateLimitMax, windowMs = this.config.security.socketRateLimitWindow) {
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

    handleDisconnect(socket) {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
            this.roomManager.leaveRoom(socket, socket.roomId);
        } else {
            this.roomManager.removeUser(socket.id);
        }
        this.socketRateLimits.delete(socket.id);
    }

    startCleanupInterval() {
        setInterval(() => {
            const now = Date.now();

            for (const [socketId] of this.socketRateLimits.entries()) {
                if (!this.io.sockets.sockets.get(socketId)) {
                    this.socketRateLimits.delete(socketId);
                }
            }

            for (const [roomId, room] of this.roomManager.rooms.entries()) {
                const ageHours = (now - room.createdAt) / (1000 * 60 * 60);
                if (room.users.size === 0 && ageHours > 24) {
                    this.roomManager.rooms.delete(roomId);
                    console.log(`Cleaned up old room: ${roomId}`);
                }
            }

            for (const [userId, queue] of this.messageQueues.entries()) {
                const filtered = queue.filter(msg => {
                    const ageDays = (now - msg.queuedAt) / (1000 * 60 * 60 * 24);
                    return ageDays < 7;
                });
                if (filtered.length === 0) {
                    this.messageQueues.delete(userId);
                } else if (filtered.length !== queue.length) {
                    this.messageQueues.set(userId, filtered);
                }
            }

            for (const [userId, bundle] of this.signalKeys.entries()) {
                const ageDays = (now - bundle.updatedAt) / (1000 * 60 * 60 * 24);
                if (ageDays > 90) {
                    this.signalKeys.delete(userId);
                    console.log(`Cleaned up old Signal keys for user ${userId}`);
                }
            }

            const totalQueued = Array.from(this.messageQueues.values()).reduce((sum, q) => sum + q.length, 0);
            console.log(`Cleanup: ${this.roomManager.rooms.size} rooms, ${this.roomManager.users.size} users, ${totalQueued} queued messages, ${this.signalKeys.size} key bundles`);
        }, 5 * 60 * 1000);
    }

    generateSecurePeerId(userId) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `${userId}-${timestamp}-${random}`;
    }

    findSocketByPeerId(peerId) {
        for (const socket of this.io.sockets.sockets.values()) {
            if (socket.peerId === peerId) return socket;
        }
        return null;
    }

    findSocketByUserId(username) {
        for (const socket of this.io.sockets.sockets.values()) {
            if (socket.username === username) return socket;
        }
        return null;
    }
}

module.exports = SocketEventHandlers;