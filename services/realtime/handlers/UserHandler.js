const { sanitizeInput } = require('../utils/sanitize');
const { isValidRoomId } = require('../utils/validate');
const crypto = require('crypto');

class UserHandler {
    constructor(parent) {
        this.config = parent.config;
        this.roomManager = parent.roomManager;
        this.rsaPublicKeys = parent.rsaPublicKeys;
        this.messageQueues = parent.messageQueues;
        this.io = parent.io;
    }

    handleJoinRoom(socket, data) {
        const { roomId, alias } = data;

        if (!roomId || !isValidRoomId(roomId, this.config.security.maxRoomIdLength)) {
            return socket.emit('join-error', { message: 'Invalid room ID' });
        }
        if (!alias || typeof alias !== 'string' || alias.length > this.config.security.maxAliasLength) {
            return socket.emit('join-error', { message: 'Invalid alias' });
        }

        if (socket.roomId && socket.roomId !== roomId) {
            console.log(`User ${socket.username} leaving room ${socket.roomId} to join ${roomId}`);
            const oldRoom = this.roomManager.rooms.get(socket.roomId);
            if (oldRoom) oldRoom.activeScreenShares?.delete(socket.peerId);
            this.roomManager.leaveRoom(socket, socket.roomId);
            socket.roomId = null;
        }

        if (!this.roomManager.rooms.has(roomId)) {
            this.roomManager.createRoom(roomId, socket.username);
        }

        const room = this.roomManager.rooms.get(roomId);
        if (!room.activeScreenShares) room.activeScreenShares = new Map();

        const peerId = socket.peerId;
        socket.join(roomId);
        socket.roomId = roomId;
        socket.alias = sanitizeInput(alias);

        const userInfo = {
            socketId: socket.id,
            peerId,
            alias: socket.alias,
            username: socket.username,
            joinedAt: Date.now()
        };

        this.roomManager.joinRoom(socket, roomId, userInfo);

        const existingUsers = Array.from(room.users.values())
            .filter(user => user.socketId !== socket.id)
            .map(user => ({ peerId: user.peerId, alias: user.alias, userId: user.username }));

        socket.emit('all-users', existingUsers);

        // Tell the new joiner about active screen shares
        if (room.activeScreenShares.size > 0) {
            room.activeScreenShares.forEach(({ peerId: sharerPeerId, alias: sharerAlias, screenPeerId }) => {
                socket.emit('peer-screenshare-started', {
                    peerId: sharerPeerId,
                    alias: sharerAlias,
                    screenPeerId,
                });
                console.log(`Notified ${socket.username} of existing screenshare by ${sharerAlias}`);

                if (socket.screenPeerId) {
                    const sharerSocket = this._findSocketByPeerId(sharerPeerId);
                    if (sharerSocket) {
                        sharerSocket.emit('new-screen-peer', {
                            screenPeerId: socket.screenPeerId,
                            alias: socket.alias,
                        });
                        console.log(`Told sharer ${sharerAlias} to call new joiner ${socket.alias}`);
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
            peerId,
            alias: socket.alias,
            userId: socket.username
        });

        const queue = this.messageQueues.get(socket.username);
        if (queue && queue.length > 0) {
            socket.emit('queued-messages', { messages: queue });
            this.messageQueues.delete(socket.username);
            console.log(`Delivered ${queue.length} queued messages to ${socket.username}`);
        }

        console.log(`User ${socket.username} joined room ${roomId} with alias: ${socket.alias}`);
    }

    handleUserUpdate(socket, data) {
        const { alias } = data;

        if (!alias || typeof alias !== 'string' || alias.length > this.config.security.maxAliasLength) {
            return socket.emit('user-error', { message: 'Invalid alias' });
        }

        const sanitizedAlias = sanitizeInput(alias);
        const user = this.roomManager.updateUserAlias(socket.id, sanitizedAlias);
        if (!user) return;

        socket.alias = sanitizedAlias;
        socket.to(user.roomId).emit('user-updated', {
            peerId: user.peerId,
            alias: sanitizedAlias
        });
    }

    handleRequestScreenPeerId(socket) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        const screenPeerId = `screen-${socket.username}-${timestamp}-${random}`;
        socket.screenPeerId = screenPeerId;
        socket.emit('screen-peer-assigned', { peerId: screenPeerId });
        console.log(`Assigned screen peer ID to ${socket.username}: ${screenPeerId}`);
    }

    handleScreenshareStarted(socket, data) {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = this.roomManager.rooms.get(roomId);
        if (!room) return;

        if (!room.activeScreenShares) room.activeScreenShares = new Map();

        const screenPeerId = data?.screenPeerId || socket.screenPeerId;
        if (!screenPeerId) {
            console.error(`No screen peer ID for ${socket.username}`);
            return;
        }

        room.activeScreenShares.set(socket.peerId, {
            peerId: socket.peerId,
            alias: socket.alias,
            screenPeerId,
        });

        socket.to(roomId).emit('peer-screenshare-started', {
            peerId: socket.peerId,
            alias: socket.alias,
            screenPeerId,
        });

        // Send sharer the screen peer IDs of everyone currently in the room
        const roomScreenPeers = [];
        const sockets = this.io.sockets.sockets;
        room.users.forEach((userInfo) => {
            if (userInfo.socketId === socket.id) return;
            const memberSocket = sockets.get(userInfo.socketId);
            if (memberSocket?.screenPeerId) {
                roomScreenPeers.push({
                    screenPeerId: memberSocket.screenPeerId,
                    alias: userInfo.alias,
                });
            }
        });

        socket.emit('room-screen-peers', { peers: roomScreenPeers });
        console.log(`User ${socket.username} started screenshare in room ${roomId}, notifying ${roomScreenPeers.length} peers`);
    }

    handleScreenshareStopped(socket) {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = this.roomManager.rooms.get(roomId);
        if (room?.activeScreenShares) {
            room.activeScreenShares.delete(socket.peerId);
        }

        socket.to(roomId).emit('peer-screenshare-stopped', { peerId: socket.peerId });
        console.log(`User ${socket.username} stopped screenshare in room ${roomId}`);
    }

    _findSocketByPeerId(peerId) {
        for (const socket of this.io.sockets.sockets.values()) {
            if (socket.peerId === peerId) return socket;
        }
        return null;
    }
}

module.exports = UserHandler;