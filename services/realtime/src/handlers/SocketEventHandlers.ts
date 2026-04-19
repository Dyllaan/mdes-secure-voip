import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import RoomManager from '../room/RoomManager';
import WebRTCHandler from './WebRTCHandler';
import UserHandler from './UserHandler';
import { RealtimeConfig } from '../config';
import { AuthenticatedSocket, RateLimitEntry, Service } from '../types';
import { verifyAccessToken } from '../auth/verifyAccessToken';

class SocketEventHandlers {
    private service: Service;
    config: RealtimeConfig;
    io: SocketIOServer;
    socketRateLimits: Map<string, Map<string, RateLimitEntry>>;
    roomManager: RoomManager;
    private webrtc: WebRTCHandler;
    private user: UserHandler;
    private rsaPublicKeys: Map<string, string> = new Map();

    constructor(service: Service) {
        this.service = service;
        this.config = service.config;
        this.io = service.io;
        this.socketRateLimits = new Map();

        this.roomManager = new RoomManager(this.config, this.io);
        this.webrtc = new WebRTCHandler(this);
        this.user = new UserHandler(this);
    }

    setup(): void {
        const lim = this.config.security;

        const tamper = (event: string, socket: AuthenticatedSocket, reason: string) =>
            console.error(`[TAMPER] event=${event} userId=${socket.userId} socketId=${socket.id} reason=${reason}`);

        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token as string | undefined;
            if (!token) return next(new Error('Authentication required'));

            const username = socket.handshake.auth.username;
            if (typeof username !== 'string' || !username || username.length > lim.maxUsernameLength) {
                return next(new Error('Invalid username'));
            }

            try {
                const decoded = verifyAccessToken(token, this.config);
                const s = socket as unknown as AuthenticatedSocket;
                s.userId = decoded.sub!;
                s.username = username;
                s.token = token;
                next();
            } catch {
                return next(new Error('Invalid or expired token'));
            }
        });

        this.io.on('connection', (rawSocket: Socket) => {
            const socket = rawSocket as AuthenticatedSocket;
            // Rate limit keyed by userId so multiple tabs share the same bucket.
            if (!this.socketRateLimits.has(socket.userId)) {
                this.socketRateLimits.set(socket.userId, new Map());
            }

            const peerId = this.generateSecurePeerId();
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
            // after joining, send the new user their own RSA key broadcast and push existing keys to them
            socket.on('join-room', (d: { roomId?: string }) => {
                if (!d?.roomId) return;
                const roomId = d.roomId;
                const myKey = this.rsaPublicKeys.get(socket.userId);
                if (myKey) {
                    socket.to(roomId).emit('user-rsa-key', { userId: socket.userId, publicKey: myKey });
                }
                for (const [userId, publicKey] of this.rsaPublicKeys.entries()) {
                    if (userId !== socket.userId) {
                        const other = this.findSocketByUserId(userId);
                        if (other?.rooms.has(roomId)) {
                            socket.emit('user-rsa-key', { userId, publicKey });
                        }
                    }
                }
            });
            socket.on('leave-room',             () => rl('leave-room', 5, 60000)   && this.handleLeaveRoom(socket));
            socket.on('user-update',            (d) => rl('user-update', 5, 60000)  && this.user.handleUserUpdate(socket, d));

            socket.on('request-screen-peer-id', ()  => rl('screen-peer', 5, 60000) && this.user.handleRequestScreenPeerId(socket));
            socket.on('screenshare-started',    (d) => rl('screenshare', 10, 10000) && this.user.handleScreenshareStarted(socket, d));
            socket.on('screenshare-stopped',    ()  => rl('screenshare', 10, 10000) && this.user.handleScreenshareStopped(socket));

            socket.on('webrtc-offer',           (d) => rl('webrtc-offer', 10, 60_000)         && this.webrtc.handleOffer(socket, d));
            socket.on('webrtc-answer',          (d) => rl('webrtc-answer', 10, 60_000)        && this.webrtc.handleAnswer(socket, d));
            socket.on('webrtc-ice-candidate',   (d) => rl('webrtc-ice-candidate', 50, 10_000) && this.webrtc.handleIceCandidate(socket, d));

            socket.on('channel-message-sent', (d) => {
                if (!rl('channel-message-sent', 30, 10000)) return;
                if (typeof d?.hubId !== 'string' || !d.hubId) return;
                if (!socket.rooms.has(`hub:${d.hubId}`)) return;
                if (typeof d?.channelId !== 'string') return;
                if (typeof d?.content !== 'string') return;
                if (d.content.length > lim.maxChannelMessageLength) {
                    tamper('channel-message-sent', socket, `content length ${d.content.length} exceeds limit`);
                    return;
                }
                socket.to(`hub:${d.hubId}`).emit('channel-message-sent', {
                    hubId: d.hubId,
                    channelId: d.channelId,
                    content: d.content,
                });
            });

            socket.on('hub:join', async (hubId: unknown) => {
                if (typeof hubId !== 'string' || !hubId) return;
                if (!rl('hub:join', 10, 60000)) return;
                const allowed = await this.roomManager.checkHubMembership(hubId, socket.token);
                if (!allowed) {
                    socket.emit('hub-join-error', { message: 'Not a member of this hub' });
                    return;
                }
                socket.join(`hub:${hubId}`);
            });
            socket.on('hub:leave', (hubId: unknown) => {
                if (typeof hubId !== 'string' || !hubId) return;
                if (!rl('hub:leave', 10, 60000)) return;
                socket.leave(`hub:${hubId}`);
            });

            socket.on('channel-created', (d) => {
                if (!rl('channel-created', 5, 60000)) return;
                if (typeof d?.hubId !== 'string' || !d.hubId) return;
                if (typeof d?.channelId !== 'string' || !d.channelId) return;
                if (typeof d?.name !== 'string') return;
                if (!socket.rooms.has(`hub:${d.hubId}`)) {
                    tamper('channel-created', socket, `not in hub:${d.hubId}`);
                    return;
                }
                if (d.name.length > lim.maxChannelNameLength) {
                    tamper('channel-created', socket, `name length ${d.name.length} exceeds limit`);
                    return;
                }
                socket.to(`hub:${d.hubId}`).emit('channel-created', {
                    hubId: d.hubId,
                    channelId: d.channelId,
                    name: d.name,
                });
            });

            socket.on('channel-deleted', (d) => {
                if (!rl('channel-deleted', 5, 60000)) return;
                if (typeof d?.hubId !== 'string' || !d.hubId) return;
                if (typeof d?.channelId !== 'string' || !d.channelId) return;
                if (!socket.rooms.has(`hub:${d.hubId}`)) {
                    tamper('channel-deleted', socket, `not in hub:${d.hubId}`);
                    return;
                }
                socket.to(`hub:${d.hubId}`).emit('channel-deleted', {
                    hubId: d.hubId,
                    channelId: d.channelId,
                });
            });

            socket.on('member-joined', (d) => {
                if (!rl('member-joined', 5, 60000)) return;
                if (typeof d?.hubId !== 'string' || !d.hubId) return;
                if (typeof d?.userId !== 'string' || !d.userId) return;
                if (!socket.rooms.has(`hub:${d.hubId}`)) {
                    tamper('member-joined', socket, `not in hub:${d.hubId}`);
                    return;
                }
                socket.to(`hub:${d.hubId}`).emit('member-joined', {
                    hubId: d.hubId,
                    userId: d.userId,
                });
            });

            socket.on('channel-key-rotated', (d) => {
                if (!rl('channel-key-rotated', 5, 60000)) return;
                if (typeof d?.hubId !== 'string' || !d.hubId) return;
                if (typeof d?.channelId !== 'string' || !d.channelId) return;
                if (!socket.rooms.has(`hub:${d.hubId}`)) {
                    tamper('channel-key-rotated', socket, `not in hub:${d.hubId}`);
                    return;
                }
                socket.to(`hub:${d.hubId}`).emit('channel-key-rotated', {
                    hubId: d.hubId,
                    channelId: d.channelId,
                });
            });

            socket.on('musicman:track-changed', (d) => {
                if (!rl('musicman', 10, 10000)) return;
                if (typeof d?.roomId !== 'string' || !socket.rooms.has(d.roomId)) {
                    tamper('musicman:track-changed', socket, `not in room ${d?.roomId}`);
                    return;
                }
                if (typeof d.title === 'string' && d.title.length > lim.maxMusicmanTitle) {
                    tamper('musicman:track-changed', socket, `title length ${d.title.length} exceeds limit`);
                    return;
                }
                if (typeof d.url === 'string' && d.url.length > lim.maxMusicmanUrl) {
                    tamper('musicman:track-changed', socket, `url length ${d.url.length} exceeds limit`);
                    return;
                }
                this.io.to(d.roomId).emit('musicman:track-changed', {
                    roomId: d.roomId,
                    title: typeof d.title === 'string' ? d.title : undefined,
                    url: typeof d.url === 'string' ? d.url : undefined,
                });
            });

            socket.on('musicman:track-ended', (d) => {
                if (!rl('musicman', 10, 10000)) return;
                if (typeof d?.roomId !== 'string' || !socket.rooms.has(d.roomId)) {
                    tamper('musicman:track-ended', socket, `not in room ${d?.roomId}`);
                    return;
                }
                this.io.to(d.roomId).emit('musicman:track-ended', { roomId: d.roomId });
            });

            socket.on('musicman:state-changed', (d) => {
                if (!rl('musicman', 10, 10000)) return;
                if (typeof d?.roomId !== 'string' || !socket.rooms.has(d.roomId)) {
                    tamper('musicman:state-changed', socket, `not in room ${d?.roomId}`);
                    return;
                }
                if (typeof d.state === 'string' && d.state.length > lim.maxMusicmanState) {
                    tamper('musicman:state-changed', socket, `state length ${d.state.length} exceeds limit`);
                    return;
                }
                this.io.to(d.roomId).emit('musicman:state-changed', {
                    roomId: d.roomId,
                    state: typeof d.state === 'string' ? d.state : undefined,
                });
            });

            socket.on('register-rsa-key', (d: { publicKey: string }) => {
                if (!rl('register-rsa-key', 5, 60000)) return;
                if (typeof d?.publicKey !== 'string' || !d.publicKey) return;
                if (d.publicKey.length > lim.maxRsaKeySize) {
                    tamper('register-rsa-key', socket, `publicKey length ${d.publicKey.length} exceeds limit`);
                    return;
                }
                this.rsaPublicKeys.set(socket.userId, d.publicKey);
                socket.emit('rsa-key-registered');
                // notify everyone in the same room so they can encrypt the room key for this user
                if (socket.roomId) {
                    socket.to(socket.roomId).emit('user-rsa-key', { userId: socket.userId, publicKey: d.publicKey });
                }
            });

            socket.on('request-room-key', (d: { roomId: string; fromUserId: string }) => {
                if (!rl('request-room-key', 10, 60000)) return;
                if (typeof d?.roomId !== 'string' || typeof d?.fromUserId !== 'string') return;
                if (!socket.rooms.has(d.roomId)) {
                    tamper('request-room-key', socket, `not in room ${d.roomId}`);
                    return;
                }
                const target = this.findSocketByUserId(d.fromUserId);
                if (!target || !target.rooms.has(d.roomId)) {
                    tamper('request-room-key', socket, `target ${d.fromUserId} not in room ${d.roomId}`);
                    return;
                }
                // send the requester's public key to the target so they can wrap the room key
                const requesterPublicKey = this.rsaPublicKeys.get(socket.userId);
                if (requesterPublicKey) {
                    target.emit('user-rsa-key', { userId: socket.userId, publicKey: requesterPublicKey });
                }
                target.emit('request-room-key', { roomId: d.roomId, requesterId: socket.userId });
            });

            socket.on('room-key-response', (d: { roomId: string; requesterId: string; encryptedKey: string; keyId: string }) => {
                if (!rl('room-key-response', 10, 60000)) return;
                if (typeof d?.requesterId !== 'string' || typeof d?.encryptedKey !== 'string') return;
                if (d.encryptedKey.length > lim.maxEncryptedKeySize) {
                    tamper('room-key-response', socket, `encryptedKey length ${d.encryptedKey.length} exceeds limit`);
                    return;
                }
                if (typeof d?.keyId !== 'string' || d.keyId.length > lim.maxChatKeyId) {
                    tamper('room-key-response', socket, `keyId length ${d.keyId?.length} exceeds limit`);
                    return;
                }
                const target = this.findSocketByUserId(d.requesterId);
                if (!target) return;
                target.emit('room-key-response', { encryptedKey: d.encryptedKey, keyId: d.keyId });
            });

            socket.on('room-chat-message', (d: { roomId: string; ciphertext: string; iv: string; keyId: string }) => {
                if (!rl('room-chat-message', 30, 10000)) return;
                if (typeof d?.roomId !== 'string' || !socket.rooms.has(d.roomId)) return;
                if (typeof d?.ciphertext !== 'string' || typeof d?.iv !== 'string' || typeof d?.keyId !== 'string') return;
                if (d.ciphertext.length > lim.maxChatCiphertext) {
                    tamper('room-chat-message', socket, `ciphertext length ${d.ciphertext.length} exceeds limit`);
                    return;
                }
                if (d.iv.length > lim.maxChatIv) {
                    tamper('room-chat-message', socket, `iv length ${d.iv.length} exceeds limit`);
                    return;
                }
                if (d.keyId.length > lim.maxChatKeyId) {
                    tamper('room-chat-message', socket, `keyId length ${d.keyId.length} exceeds limit`);
                    return;
                }
                socket.to(d.roomId).emit('room-chat-message', {
                    senderUserId: socket.userId,
                    senderAlias: socket.username,
                    ciphertext: d.ciphertext,
                    iv: d.iv,
                    keyId: d.keyId,
                    roomId: d.roomId,
                    timestamp: new Date().toISOString(),
                });
            });

            // Periodically re-validate room access; kick
            const REVALIDATION_MS = 5 * 60 * 1000;
            const revalidationTimer = setInterval(async () => {
                if (!socket.roomId) return;
                const allowed = await this.roomManager.checkChannelAccess(socket.roomId, socket.token);
                if (!allowed) {
                    this.roomManager.forceLeaveRoom(socket);
                }
            }, REVALIDATION_MS);

            // Re-verify JWT every 15 min, disconnect if expired
            const REAUTH_MS = 15 * 60 * 1000;
            const reauthTimer = setInterval(() => {
                try {
                    verifyAccessToken(socket.token, this.config);
                } catch {
                    socket.emit('session-expired', { message: 'Session expired, please log in again' });
                    socket.disconnect(true);
                }
            }, REAUTH_MS);

            socket.on('disconnect', () => {
                clearInterval(revalidationTimer);
                clearInterval(reauthTimer);
                this.handleDisconnect(socket);
            });
        });
    }

    checkSocketRateLimit(
        socket: AuthenticatedSocket,
        action: string,
        max: number = this.config.security.socketRateLimitMax,
        windowMs: number = this.config.security.socketRateLimitWindow
    ): boolean {
        const socketLimits = this.socketRateLimits.get(socket.userId);
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
        this.rsaPublicKeys.delete(socket.userId);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
            this.roomManager.leaveRoom(socket, socket.roomId);
        } else {
            this.roomManager.removeUser(socket.id);
        }
        // Only clear rate limit bucket when this user has no remaining sockets.
        const stillConnected = Array.from(this.io.sockets.sockets.values()).some(
            (s) => s.id !== socket.id && (s as AuthenticatedSocket).userId === socket.userId
        );
        if (!stillConnected) {
            this.socketRateLimits.delete(socket.userId);
        }
    }

    startCleanupInterval(): void {
        setInterval(() => {
            const now = Date.now();

            const connectedUserIds = new Set(
                Array.from(this.io.sockets.sockets.values()).map((s) => (s as AuthenticatedSocket).userId)
            );
            for (const [userId] of this.socketRateLimits.entries()) {
                if (!connectedUserIds.has(userId)) {
                    this.socketRateLimits.delete(userId);
                }
            }

            for (const [roomId, room] of this.roomManager.rooms.entries()) {
                const ageHours = (now - room.createdAt) / (1000 * 60 * 60);
                if (room.users.size === 0 && ageHours > 24) {
                    this.roomManager.deleteRoom(roomId);
                }
            }

        }, 5 * 60 * 1000);
    }

    generateSecurePeerId(): string {
        return crypto.randomUUID();
    }

    findSocketByPeerId(peerId: string): AuthenticatedSocket | null {
        for (const socket of this.io.sockets.sockets.values()) {
            const s = socket as AuthenticatedSocket;
            if (s.peerId === peerId) return s;
        }
        return null;
    }

    findSocketByUserId(userId: string): AuthenticatedSocket | null {
        for (const socket of this.io.sockets.sockets.values()) {
            const s = socket as AuthenticatedSocket;
            if (s.userId === userId) return s;
        }
        return null;
    }

    handleLeaveRoom(socket: AuthenticatedSocket): void {
        const { roomId } = socket;
        if (!roomId) return;

        const room = this.roomManager.rooms.get(roomId);
        if (room) {
            const activeScreenShares = (room as any).activeScreenShares as Map<string, { peerId: string; screenPeerId: string }> | undefined;
            const share = activeScreenShares?.get(socket.peerId);
            if (share) {
                socket.to(roomId).emit('peer-screenshare-stopped', { peerId: socket.peerId, screenPeerId: share.screenPeerId });
                activeScreenShares!.delete(socket.peerId);
            }
        }

        socket.to(roomId).emit('user-disconnected', socket.peerId);
        this.roomManager.leaveRoom(socket, roomId);
        socket.roomId = undefined;
    }
}

export default SocketEventHandlers;
