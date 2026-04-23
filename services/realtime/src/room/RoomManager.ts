import { Server as SocketIOServer } from 'socket.io';
import { RealtimeConfig } from '../config';
import { AuthenticatedSocket, RoomUser, UserInfo } from '../types';

interface Room {
    id: string;
    users: Map<string, UserInfo>;
    createdBy: string;
    createdAt: number;
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

    forceLeaveRoom(socket: AuthenticatedSocket): void {
        if (!socket.roomId) return;
        this.leaveRoom(socket, socket.roomId);
        socket.emit('kicked-from-room', { reason: 'access-revoked' });
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
        try {
            const res = await fetch(
                `${this.config.hubServiceUrl}/channels/${channelId}/access`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            return res.ok;
        } catch {
            return false;
        }
    }

    async checkHubMembership(hubId: string, token: string): Promise<boolean> {
        try {
            const res = await fetch(
                `${this.config.hubServiceUrl}/hubs/${hubId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            return res.ok;
        } catch {
            return false;
        }
    }

    public get rooms(): Map<string, Room> {
        return this._rooms;
    }

    public get users(): Map<string, RoomUser> {
        return this._users;
    }
}

export default RoomManager;