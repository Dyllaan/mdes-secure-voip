import { Server as SocketIOServer } from 'socket.io';
import { RealtimeConfig } from '../config';

interface UserInfo {
    userId: string;
    username: string;
    peerId: string;
    alias: string;
    socketId: string;
}

interface RoomUser extends UserInfo {
    roomId: string;
}

interface Room {
    id: string;
    users: Map<string, UserInfo>;
    createdBy: string;
    createdAt: number;
}

interface AuthenticatedSocket {
    id: string;
    token: string;
    roomId?: string;
    peerId?: string;
    join: (room: string) => void;
    leave: (room: string) => void;
    emit: (event: string, data: unknown) => void;
    to: (room: string) => { emit: (event: string, data: unknown) => void };
}

class RoomManager {
    private config: RealtimeConfig;
    private io: SocketIOServer;
    private _rooms: Map<string, Room>;
    private _users: Map<string, RoomUser>;

    constructor(config: RealtimeConfig, io: SocketIOServer) {
        this.config = config;
        this.io = io;
        this._rooms = new Map();
        this._users = new Map();
    }

    createRoom(roomId: string, createdBy: string): void {
        this._rooms.set(roomId, {
            id: roomId,
            users: new Map(),
            createdBy,
            createdAt: Date.now()
        });
        console.log(`Room created: ${roomId} by user ${createdBy}`);
    }

    async joinRoom(socket: AuthenticatedSocket, roomId: string, userInfo: UserInfo): Promise<boolean> {
        const allowed = await this.checkChannelAccess(roomId, socket.token);
        if (!allowed) {
            socket.emit('join-error', { message: 'Access denied to this channel' });
            return false;
        }

        if (!this.rooms.has(roomId)) {
            this.createRoom(roomId, userInfo.userId);
        }

        const room = this.rooms.get(roomId)!;
        socket.join(roomId);
        socket.roomId = roomId;
        room.users.set(socket.id, userInfo);
        this.users.set(socket.id, { ...userInfo, roomId });

        console.log(`User ${userInfo.username} joined room ${roomId}`);
        this.broadcastRoomList();
        return true;
    }

    leaveRoom(socket: AuthenticatedSocket, roomId: string): void {
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

        this.broadcastRoomList();
    }

    getExistingUsers(roomId: string, excludeSocketId: string): Pick<UserInfo, 'peerId' | 'alias' | 'userId'>[] {
        const room = this.rooms.get(roomId);
        if (!room) return [];

        return Array.from(room.users.values())
            .filter(user => user.socketId !== excludeSocketId)
            .map(({ peerId, alias, userId }) => ({ peerId, alias, userId }));
    }

    updateUserAlias(socketId: string, alias: string): RoomUser | null {
        const user = this.users.get(socketId);
        if (!user) return null;

        user.alias = alias;
        const room = this.rooms.get(user.roomId);
        if (room) {
            room.users.get(socketId)!.alias = alias;
        }

        return user;
    }

    removeUser(socketId: string): void {
        this.users.delete(socketId);
    }

    deleteRoom(roomId: string): void {
        this.rooms.delete(roomId);
    }

    broadcastRoomList(): void {
        const rooms = Array.from(this.rooms.entries()).map(([id, room]) => ({
            id,
            userCount: room.users.size,
            createdBy: room.createdBy,
        }));
        this.io.emit('room-list', { rooms });
    }

    async checkChannelAccess(channelId: string, token: string): Promise<boolean> {
        console.log('checkChannelAccess:', { channelId, token: token ? 'present' : 'MISSING' });
        try {
            const res = await fetch(
                `${this.config.hubServiceUrl}/channels/${channelId}/access`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log('hub service response:', res.status);
            const body = await res.json();
            console.log('hub service body:', body);
            return res.ok;
        } catch (err) {
            console.error('Channel access check failed:', err);
            return false;
        }
    }

    public get rooms(): Map<string, Room> {
        return this._rooms;  // rename private field to _rooms
    }

    public get users(): Map<string, RoomUser> {
        return this._users;
    }
}

export default RoomManager;