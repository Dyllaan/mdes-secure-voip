import { Socket, Server as SocketIOServer } from 'socket.io';
import RoomManager from './room/RoomManager';
import { RealtimeConfig } from './config';

interface PreKey {
    keyId: number;
    publicKey: string;
}

interface SignedPreKey {
    keyId: number;
    publicKey: string;
    signature: string;
}

interface SignalKeyBundle {
    userId: string;
    identityKey: string;
    signedPreKey: SignedPreKey;
    preKeys: Map<number, PreKey>;
    registrationId: number;
    createdAt: number;
    updatedAt: number;
}

interface RegisterKeysData {
    identityKey: string;
    signedPreKey: SignedPreKey;
    preKeys: PreKey[];
    registrationId: number;
}

interface RequestBundleData {
    recipientUserId: string;
}

interface RefreshPrekeysData {
    preKeys: PreKey[];
}

interface Parent {
    config: RealtimeConfig;
    roomManager: RoomManager;
    signalKeys: Map<string, SignalKeyBundle>;
    messageQueues: Map<string, ChatMessage[]>;
    rsaPublicKeys: Map<string, string>;
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
    signalKeys: Map<string, SignalKeyBundle>;
    messageQueues: Map<string, ChatMessage[]>;
    io: SocketIOServer;
}

interface ChatMessage {
    id: string;
    senderUserId: string;
    senderPeerId: string;
    senderAlias: string;
    ciphertext: string;
    type: 1 | 3;
    registrationId: number;
    timestamp: string;
    queuedAt?: number;
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

interface QueuedMessage {
    queuedAt: number;
    [key: string]: unknown;
}

interface SignalBundle {
    updatedAt: number;
    [key: string]: unknown;
}

interface Service {
    config: RealtimeConfig;
    io: SocketIOServer;
}


export type {
    PreKey,
    SignedPreKey,
    SignalKeyBundle,
    RegisterKeysData,
    RequestBundleData,
    RefreshPrekeysData,
    Parent,
    Room,
    UserInfo,
    RoomUser,
    ScreenShare,
    SocketHandlers,
    ChatMessage,
    AuthenticatedSocket,
    RateLimitEntry,
    QueuedMessage,
    SignalBundle,
    Service,
};