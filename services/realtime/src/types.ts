import { Socket, Server as SocketIOServer } from 'socket.io';
import RoomManager from './room/RoomManager';
import { RealtimeConfig } from './config';


interface Parent {
    config: RealtimeConfig;
    roomManager: RoomManager;
    io: SocketIOServer;
    findSocketByUserId: (username: string) => AuthenticatedSocket | null;
    findSocketByPeerId: (peerId: string) => AuthenticatedSocket | null;
}


interface Room {
    id: string;
    users: Map<string, UserInfo>;
    createdBy: string;
    createdAt: number;
    activeScreenShares?: Map<string, ScreenShare>;
}

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

interface ScreenShare {
    peerId: string;
    alias: string;
    screenPeerId: string;
}

interface SocketHandlers {
    roomManager: RoomManager;
    io: SocketIOServer;
}

interface AuthenticatedSocket extends Socket {
    userId: string;
    username: string;
    token: string;
    peerId: string;
    roomId?: string;
}

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

interface Service {
    config: RealtimeConfig;
    io: SocketIOServer;
}


export type {
    Parent,
    Room,
    UserInfo,
    RoomUser,
    SocketHandlers,
    AuthenticatedSocket,
    RateLimitEntry,
    Service,
};