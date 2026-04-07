import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import RoomManager from '../room/RoomManager';
import SignalProtocolHandler from './SignalProtocolHandler';
import RoomKeyHandler from './RoomKeyHandler';
import WebRTCHandler from './WebRTCHandler';
import ChatHandler from './ChatHandler';
import UserHandler from './UserHandler';
import { RealtimeConfig } from '../config';
import { AuthenticatedSocket, RateLimitEntry, Service, ChatMessage, SignalKeyBundle } from '../types';

class SocketEventHandlers {
    private service: Service;
    config: RealtimeConfig;
    io: SocketIOServer;
    socketRateLimits: Map<string, Map<string, RateLimitEntry>>;
    signalKeys: Map<string, SignalKeyBundle>;
    messageQueues: Map<string, ChatMessage[]>;
    rsaPublicKeys: Map<string, string>;
    roomManager: RoomManager;
    private signal: SignalProtocolHandler;
    private roomKey: RoomKeyHandler;
    private webrtc: WebRTCHandler;
    private chat: ChatHandler;
    private user: UserHandler;

    constructor(service: Service) {
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

    setup(): void {
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token as string | undefined;
            if (!token) return next(new Error('Authentication required'));
            try {
                const secret = Buffer.from(this.config.jwt.secret, 'base64');
                const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
                const s = socket as unknown as AuthenticatedSocket;
                s.userId = decoded.sub!;
                s.username = socket.handshake.auth.username as string;
                s.token = token;
                next();
            } catch {
                return next(new Error('Invalid or expired token'));
            }
        });

        this.io.on('connection', (rawSocket: Socket) => {
            const socket = rawSocket as AuthenticatedSocket;
            this.socketRateLimits.set(socket.id, new Map());

            const peerId = this.generateSecurePeerId(socket.username);
            socket.peerId = peerId;
            socket.emit('peer-assigned', { peerId });

            const rooms = Array.from(this.roomManager.rooms.entries()).map(([id, room]) => ({
                id,
                userCount: room.users.size,
                createdBy: room.createdBy,
            }));
            socket.emit('room-list', { rooms });

            const rl = (action: string, max?: number, window?: number): boolean =>
                this.checkSocketRateLimit(socket, action, max, window);

            socket.on('join-room',              (d) => rl('join-room', 5, 60000)    && this.user.handleJoinRoom(socket, d));
            socket.on('user-update',            (d) => rl('user-update', 5, 60000)  && this.user.handleUserUpdate(socket, d));

            socket.on('request-screen-peer-id', ()  => rl('screen-peer', 5, 60000) && this.user.handleRequestScreenPeerId(socket));
            socket.on('screenshare-started',    (d) => rl('screenshare', 10, 10000) && this.user.handleScreenshareStarted(socket, d));
            socket.on('screenshare-stopped',    ()  => rl('screenshare', 10, 10000) && this.user.handleScreenshareStopped(socket));

            socket.on('webrtc-offer',           (d) => rl('webrtc-offer')           && this.webrtc.handleOffer(socket, d));
            socket.on('webrtc-answer',          (d) => rl('webrtc-answer')          && this.webrtc.handleAnswer(socket, d));
            socket.on('webrtc-ice-candidate',   (d) => rl('webrtc-ice-candidate')   && this.webrtc.handleIceCandidate(socket, d));

            socket.on('signal-register-keys',   (d) => rl('signal-register-keys', 5, 60000)     && this.signal.handleRegisterKeys(socket, d));
            socket.on('signal-request-bundle',  (d) => rl('signal-request-bundle', 30, 60000)   && this.signal.handleRequestBundle(socket, d));
            socket.on('signal-refresh-prekeys', (d) => rl('signal-refresh-prekeys', 10, 300000) && this.signal.handleRefreshPrekeys(socket, d));

            socket.on('register-rsa-key',       (d) => rl('register-rsa-key', 5, 60000)   && this.roomKey.handleRegisterRSAKey(socket, d));
            socket.on('request-rsa-key',        (d) => rl('request-rsa-key', 30, 60000)   && this.roomKey.handleRequestRSAKey(socket, d));
            socket.on('request-room-key',       (d) => rl('request-room-key', 5, 60000)   && this.roomKey.handleRoomKeyRequest(socket, d));
            socket.on('room-key-response',      (d) => rl('room-key-response', 10, 60000) && this.roomKey.handleRoomKeyResponse(socket, d));

            socket.on('encrypted-chat-message', (d) => rl('encrypted-chat-message', 10, 10000) && this.chat.handleEncryptedMessage(socket, d));
            socket.on('room-chat-message',      (d) => rl('room-chat-message', 10, 10000)       && this.chat.handleRoomMessage(socket, d));

            socket.on('channel-message-sent',   (d) => rl('channel-message-sent', 30, 10000) && socket.broadcast.emit('channel-message-sent', d));

            socket.on('hub:join', (hubId: unknown) => {
                if (typeof hubId !== 'string' || !hubId) return;
                socket.join(`hub:${hubId}`);
            });
            socket.on('hub:leave', (hubId: unknown) => {
                if (typeof hubId !== 'string' || !hubId) return;
                socket.leave(`hub:${hubId}`);
            });

            socket.on('channel-created',     (d) => rl('channel-created', 5, 60000)     && socket.to(`hub:${d.hubId}`).emit('channel-created', d));
            socket.on('channel-deleted',     (d) => rl('channel-deleted', 5, 60000)     && socket.to(`hub:${d.hubId}`).emit('channel-deleted', d));
            socket.on('member-joined',       (d) => rl('member-joined', 5, 60000)       && socket.to(`hub:${d.hubId}`).emit('member-joined', d));
            socket.on('channel-key-rotated', (d) => rl('channel-key-rotated', 5, 60000) && socket.to(`hub:${d.hubId}`).emit('channel-key-rotated', d));

            socket.on('musicman:track-changed', (d) => { if (d?.roomId) this.io.to(d.roomId).emit('musicman:track-changed', d); });
            socket.on('musicman:track-ended',   (d) => { if (d?.roomId) this.io.to(d.roomId).emit('musicman:track-ended', d); });
            socket.on('musicman:state-changed', (d) => { if (d?.roomId) this.io.to(d.roomId).emit('musicman:state-changed', d); });

            socket.on('disconnect', () => this.handleDisconnect(socket));
        });
    }

    checkSocketRateLimit(
        socket: AuthenticatedSocket,
        action: string,
        max: number = this.config.security.socketRateLimitMax,
        windowMs: number = this.config.security.socketRateLimitWindow
    ): boolean {
        const socketLimits = this.socketRateLimits.get(socket.id);
        if (!socketLimits) return false;

        const now = Date.now();
        const actionLimit: RateLimitEntry = socketLimits.get(action) ?? { count: 0, resetAt: now + windowMs };

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
                retryAfter: actionLimit.resetAt - now,
            });
            return false;
        }

        return true;
    }

    handleDisconnect(socket: AuthenticatedSocket): void {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
            this.roomManager.leaveRoom(socket, socket.roomId);
        } else {
            this.roomManager.removeUser(socket.id);
        }
        this.socketRateLimits.delete(socket.id);
    }

    startCleanupInterval(): void {
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
                    this.roomManager.deleteRoom(roomId);
                }
            }

            for (const [userId, queue] of this.messageQueues.entries()) {
                const filtered = queue.filter(msg => {
                    const ageDays = (now - (msg as ChatMessage & { queuedAt: number }).queuedAt) / (1000 * 60 * 60 * 24);
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
                }
            }
        }, 5 * 60 * 1000);
    }

    generateSecurePeerId(userId: string): string {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `${userId}-${timestamp}-${random}`;
    }

    findSocketByPeerId(peerId: string): AuthenticatedSocket | null {
        for (const socket of this.io.sockets.sockets.values()) {
            const s = socket as AuthenticatedSocket;
            if (s.peerId === peerId) return s;
        }
        return null;
    }

    findSocketByUserId(username: string): AuthenticatedSocket | null {
        for (const socket of this.io.sockets.sockets.values()) {
            const s = socket as AuthenticatedSocket;
            if (s.username === username) return s;
        }
        return null;
    }
}

export default SocketEventHandlers;