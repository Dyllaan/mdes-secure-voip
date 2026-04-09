import { sanitizeInput } from '../utils/sanitize';
import { AuthenticatedSocket } from '../types';
import RoomManager from '../room/RoomManager';

interface RegisterRSAKeyData {
    publicKey: string;
}

interface RequestRSAKeyData {
    userId: string;
}

interface RoomKeyRequestData {
    roomId: string;
    fromUserId: string;
}

interface RoomKeyResponseData {
    roomId: string;
    requesterId: string;
    encryptedKey: string;
    keyId: string;
}

interface Parent {
    rsaPublicKeys: Map<string, string>;
    roomManager: RoomManager;
    findSocketByUserId: (username: string) => AuthenticatedSocket | null;
}

class RoomKeyHandler {
    private rsaPublicKeys: Map<string, string>;
    private roomManager: RoomManager;
    private findSocketByUserId: (username: string) => AuthenticatedSocket | null;

    constructor(parent: Parent) {
        this.rsaPublicKeys = parent.rsaPublicKeys;
        this.roomManager = parent.roomManager;
        this.findSocketByUserId = parent.findSocketByUserId.bind(parent);
    }

    handleRegisterRSAKey(socket: AuthenticatedSocket, data: RegisterRSAKeyData): void {
        const { publicKey } = data;
        if (!publicKey || typeof publicKey !== 'string') {
            socket.emit('signal-error', { message: 'Invalid RSA public key' });
            return;
        }
        if (publicKey.length > 1000) {
            socket.emit('signal-error', { message: 'RSA public key too large' });
            return;
        }
        const sanitized = sanitizeInput(publicKey);
        this.rsaPublicKeys.set(socket.username, sanitized);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-rsa-key', { userId: socket.username, publicKey: sanitized });
        }
        socket.emit('rsa-key-registered', { success: true });
    }

    handleRequestRSAKey(socket: AuthenticatedSocket, data: RequestRSAKeyData): void {
        const { userId } = data;
        if (!userId || typeof userId !== 'string') {
            socket.emit('signal-error', { message: 'Invalid user ID' });
            return;
        }

        // Only share RSA keys between users who are in the same room.
        const targetSocket = this.findSocketByUserId(userId);
        if (!targetSocket || !socket.roomId || targetSocket.roomId !== socket.roomId) {
            socket.emit('signal-error', { message: 'User not found in your current room' });
            return;
        }

        const publicKey = this.rsaPublicKeys.get(userId);
        if (!publicKey) {
            socket.emit('signal-error', { message: 'RSA public key not found for user' });
            return;
        }
        socket.emit('user-rsa-key', { userId, publicKey: sanitizeInput(publicKey) });
    }

    handleRoomKeyRequest(socket: AuthenticatedSocket, data: RoomKeyRequestData): void {
        const { roomId, fromUserId } = data;
        if (!roomId || !socket.roomId || socket.roomId !== roomId) {
            socket.emit('signal-error', { message: 'Not in specified room' });
            return;
        }
        const providerSocket = this.findSocketByUserId(fromUserId);
        if (!providerSocket) {
            socket.emit('signal-error', { message: 'Key provider not found' });
            return;
        }
        providerSocket.emit('request-room-key', { roomId, requesterId: socket.username });
    }

    handleRoomKeyResponse(socket: AuthenticatedSocket, data: RoomKeyResponseData): void {
        const { roomId, requesterId, encryptedKey, keyId } = data;
        if (!roomId || !socket.roomId || socket.roomId !== roomId) {
            socket.emit('signal-error', { message: 'Not in specified room' });
            return;
        }
        const requesterSocket = this.findSocketByUserId(requesterId);
        if (!requesterSocket) {
            socket.emit('signal-error', { message: 'Requester not found' });
            return;
        }
        requesterSocket.emit('room-key-response', {
            encryptedKey: sanitizeInput(encryptedKey),
            keyId: sanitizeInput(keyId),
        });
    }
}

export default RoomKeyHandler;