class RoomManager {
    constructor(config) {
        this.config = config;
        this.rooms = new Map(); // roomId -> room state
        this.users = new Map(); // socketId -> user info
    }

    createRoom(roomId, createdBy) {
        this.rooms.set(roomId, {
            id: roomId,
            users: new Map(),
            createdBy,
            createdAt: Date.now()
        });
        console.log(`Room created: ${roomId} by user ${createdBy}`);
    }

    joinRoom(socket, roomId, userInfo) {
        if (!this.rooms.has(roomId)) {
            this.createRoom(roomId, userInfo.userId);
        }
        const room = this.rooms.get(roomId);
        socket.join(roomId);
        socket.roomId = roomId;
        room.users.set(socket.id, userInfo);
        this.users.set(socket.id, { ...userInfo, roomId });
        console.log(`User ${userInfo.username} joined room ${roomId}`);
    }

    leaveRoom(socket, roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.users.delete(socket.id);
        this.users.delete(socket.id);
        socket.leave(roomId);

        // FIX: was emitting 'user-left' but frontend listens for 'user-disconnected'
        socket.to(roomId).emit('user-disconnected', socket.peerId);

        if (room.users.size === 0) {
            this.rooms.delete(roomId);
            console.log(`Room deleted: ${roomId} (empty)`);
        }
    }

    getExistingUsers(roomId, excludeSocketId) {
        const room = this.rooms.get(roomId);
        if (!room) return [];
        return Array.from(room.users.values())
            .filter(user => user.socketId !== excludeSocketId)
            .map(user => ({ peerId: user.peerId, alias: user.alias, userId: user.userId }));
    }

    updateUserAlias(socketId, alias) {
        const user = this.users.get(socketId);
        if (!user) return null;
        user.alias = alias;
        const room = this.rooms.get(user.roomId);
        if (room) {
            room.users.get(socketId).alias = alias;
        }
        return user;
    }

    removeUser(socketId) {
        this.users.delete(socketId);
    }

    deleteRoom(roomId) {
        this.rooms.delete(roomId);
    }
}

module.exports = RoomManager;