class RoomManager {
    constructor(config, io) {
        this.config = config;
        this.io = io;
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
        this.broadcastRoomList();
    }

    leaveRoom(socket, roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        room.users.delete(socket.id);
        this.users.delete(socket.id);
        socket.leave(roomId);
        socket.to(roomId).emit('user-disconnected', socket.peerId);
        if (room.users.size === 0) {
            this.rooms.delete(roomId);
            console.log(`Room deleted: ${roomId} (empty)`);
        }
        this.broadcastRoomList(); // after potential deletion
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

    broadcastRoomList() {
    const rooms = Array.from(this.rooms.entries()).map(([id, room]) => ({
        id,
        userCount: room.users.size,
        createdBy: room.createdBy,
    }));
    this.io.emit('room-list', { rooms });
    }
}

module.exports = RoomManager;