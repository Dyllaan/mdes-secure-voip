import crypto from 'crypto';
import { sanitizeInput } from '../utils/sanitize';
import { isValidRoomId } from '../utils/validate';
import { AuthenticatedSocket, Parent, ChatMessage } from '../types';
import RoomManager from '../room/RoomManager';
import { RealtimeConfig } from '../config';
import { Server as SocketIOServer } from 'socket.io';

interface ScreenShare {
    peerId: string;
    alias: string;
    screenPeerId: string;
}

interface JoinRoomData {
    roomId: string;
    alias: string;
}

interface UserUpdateData {
    alias: string;
}

interface ScreenshareStartedData {
    screenPeerId?: string;
}

class UserHandler {
    private config: RealtimeConfig;
    private roomManager: RoomManager;
    private rsaPublicKeys: Map<string, string>;
    private messageQueues: Map<string, ChatMessage[]>;
    private io: SocketIOServer;

    constructor(parent: Parent) {
        this.config = parent.config;
        this.roomManager = parent.roomManager;
        this.rsaPublicKeys = parent.rsaPublicKeys;
        this.messageQueues = parent.messageQueues;
        this.io = parent.io;
    }

    async handleJoinRoom(socket: AuthenticatedSocket, data: JoinRoomData): Promise<true | void> {
        const { roomId, alias } = data;

        if (!roomId || !isValidRoomId(roomId, this.config.security.maxRoomIdLength)) {
            socket.emit('join-error', { message: 'Invalid room ID' });
            return;
        }
        if (!alias || typeof alias !== 'string' || alias.length > this.config.security.maxAliasLength) {
            socket.emit('join-error', { message: 'Invalid alias' });
            return;
        }

        if (socket.roomId && socket.roomId !== roomId) {
            const oldRoom = this.roomManager.rooms.get(socket.roomId);
            if (oldRoom) (oldRoom as any).activeScreenShares?.delete(socket.peerId);
            this.roomManager.leaveRoom(socket, socket.roomId);
            socket.roomId = undefined;
        }

        if (!this.roomManager.rooms.has(roomId)) {
            this.roomManager.createRoom(roomId, socket.username);
        }

        const room = this.roomManager.rooms.get(roomId)!;
        if (!(room as any).activeScreenShares) {
            (room as any).activeScreenShares = new Map<string, ScreenShare>();
        }
        const activeScreenShares = (room as any).activeScreenShares as Map<string, ScreenShare>;

        const userInfo = {
            socketId: socket.id,
            peerId: socket.peerId,
            alias: sanitizeInput(alias),
            username: socket.username,
            userId: socket.userId,
            joinedAt: Date.now(),
        };

        const joined = await this.roomManager.joinRoom(socket, roomId, userInfo);
        if (!joined) return;

        socket.join(roomId);
        socket.roomId = roomId;
        (socket as any).alias = sanitizeInput(alias);

        const existingUsers = Array.from(room.users.values())
            .filter(user => user.socketId !== socket.id)
            .map(user => ({ peerId: user.peerId, alias: user.alias, userId: user.username }));

        socket.emit('all-users', existingUsers);

        if (activeScreenShares.size > 0) {
            activeScreenShares.forEach(({ peerId: sharerPeerId, alias: sharerAlias, screenPeerId }) => {
                socket.emit('peer-screenshare-started', { peerId: sharerPeerId, alias: sharerAlias, screenPeerId });

                if ((socket as any).screenPeerId) {
                    const sharerSocket = this._findSocketByPeerId(sharerPeerId);
                    if (sharerSocket) {
                        sharerSocket.emit('new-screen-peer', {
                            screenPeerId: (socket as any).screenPeerId,
                            alias: (socket as any).alias
                        });
                    }
                }
            });
        }

        existingUsers.forEach(user => {
            const rsaKey = this.rsaPublicKeys.get(user.userId);
            if (rsaKey) socket.emit('user-rsa-key', { userId: user.userId, publicKey: rsaKey });
        });

        const newUserRSAKey = this.rsaPublicKeys.get(socket.username);
        if (newUserRSAKey) {
            socket.to(roomId).emit('user-rsa-key', { userId: socket.username, publicKey: newUserRSAKey });
        }

        socket.to(roomId).emit('user-connected', {
            peerId: socket.peerId,
            alias: (socket as any).alias,
            userId: socket.username
        });

        const queue = this.messageQueues.get(socket.username);
        if (queue && queue.length > 0) {
            socket.emit('queued-messages', { messages: queue });
            this.messageQueues.delete(socket.username);
        }

        return true;
    }

    handleUserUpdate(socket: AuthenticatedSocket, data: UserUpdateData): void {
        const { alias } = data;

        if (!alias || typeof alias !== 'string' || alias.length > this.config.security.maxAliasLength) {
            socket.emit('user-error', { message: 'Invalid alias' });
            return;
        }

        const sanitizedAlias = sanitizeInput(alias);
        const user = this.roomManager.updateUserAlias(socket.id, sanitizedAlias);
        if (!user) return;

        (socket as any).alias = sanitizedAlias;
        socket.to(user.roomId).emit('user-updated', { peerId: user.peerId, alias: sanitizedAlias });
    }

    handleRequestScreenPeerId(socket: AuthenticatedSocket): void {
        const screenPeerId = `screen-${socket.username}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        (socket as any).screenPeerId = screenPeerId;
        socket.emit('screen-peer-assigned', { peerId: screenPeerId });

        // If the user is already in a room, notify any active screensharers so they can call
        // this peer. This covers the race where join-room is processed before request-screen-peer-id,
        // which would otherwise leave the screensharer with no peers to call.
        const { roomId } = socket;
        if (!roomId) return;
        const room = this.roomManager.rooms.get(roomId);
        if (!room) return;
        const activeScreenShares = (room as any).activeScreenShares as Map<string, ScreenShare> | undefined;
        if (!activeScreenShares || activeScreenShares.size === 0) return;

        for (const { peerId: sharerPeerId } of activeScreenShares.values()) {
            if (sharerPeerId === socket.peerId) continue;
            const sharerSocket = this._findSocketByPeerId(sharerPeerId);
            if (sharerSocket) {
                sharerSocket.emit('new-screen-peer', {
                    screenPeerId,
                    alias: (socket as any).alias ?? socket.username,
                });
            }
        }
    }

    handleScreenshareStarted(socket: AuthenticatedSocket, data: ScreenshareStartedData): void {
        const { roomId } = socket;
        if (!roomId) return;

        const room = this.roomManager.rooms.get(roomId);
        if (!room) return;

        if (!(room as any).activeScreenShares) {
            (room as any).activeScreenShares = new Map<string, ScreenShare>();
        }
        const activeScreenShares = (room as any).activeScreenShares as Map<string, ScreenShare>;

        const screenPeerId = data?.screenPeerId ?? (socket as any).screenPeerId as string | undefined;
        if (!screenPeerId) return;

        activeScreenShares.set(socket.peerId, { peerId: socket.peerId, alias: (socket as any).alias, screenPeerId });
        socket.to(roomId).emit('peer-screenshare-started', {
            peerId: socket.peerId,
            alias: (socket as any).alias,
            screenPeerId
        });

        const roomScreenPeers: { screenPeerId: string; alias: string }[] = [];
            room.users.forEach((userInfo) => {
            if (userInfo.socketId === socket.id) return;
                const memberSocket = this.io.sockets.sockets.get(userInfo.socketId) as AuthenticatedSocket | undefined;
                console.log(`[screenshare] checking member ${userInfo.alias} socket=${!!memberSocket} screenPeerId=${(memberSocket as any)?.screenPeerId}`);
                if ((memberSocket as any)?.screenPeerId) {
                    roomScreenPeers.push({
                        screenPeerId: (memberSocket as any).screenPeerId,
                        alias: userInfo.alias
                    });
                }
            });

        socket.emit('room-screen-peers', { peers: roomScreenPeers });
    }

    handleScreenshareStopped(socket: AuthenticatedSocket): void {
        const { roomId } = socket;
        if (!roomId) return;

        const room = this.roomManager.rooms.get(roomId);
        if (room) {
            (room as any).activeScreenShares?.delete(socket.peerId);
        }

        socket.to(roomId).emit('peer-screenshare-stopped', { peerId: socket.peerId });
    }

    private _findSocketByPeerId(peerId: string): AuthenticatedSocket | null {
        for (const socket of this.io.sockets.sockets.values()) {
            if ((socket as any).peerId === peerId) return socket as AuthenticatedSocket;
        }
        return null;
    }
}

export default UserHandler;