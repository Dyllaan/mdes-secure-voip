import crypto from 'crypto';
import { sanitizeInput } from '../utils/sanitize';
import { AuthenticatedSocket, ChatMessage, Parent } from '../types';
import RoomManager from '../room/RoomManager';
import { RealtimeConfig } from '../config';

interface EncryptedMessageData {
    recipientUserId: string;
    ciphertext: string;
    type: 1 | 3;
    registrationId: number;
}

interface QueuedMessagePayload {
    ciphertext: string;
    type: 1 | 3;
    registrationId: number;
}

interface RoomMessageData {
    roomId: string;
    ciphertext: string;
    iv: string;
    keyId: string;
}

class ChatHandler {
    private config: RealtimeConfig;
    private messageQueues: Map<string, ChatMessage[]>;
    private roomManager: RoomManager;
    private findSocketByUserId: (username: string) => AuthenticatedSocket | null;

    constructor(parent: Parent) {
        this.config = parent.config;
        this.messageQueues = parent.messageQueues;
        this.roomManager = parent.roomManager;
        this.findSocketByUserId = parent.findSocketByUserId.bind(parent);
    }

    handleEncryptedMessage(socket: AuthenticatedSocket, data: EncryptedMessageData): void {
        const { recipientUserId, ciphertext, type, registrationId } = data;

        const user = this.roomManager.users.get(socket.id);
        if (!user) {
            socket.emit('chat-error', { message: 'Not authenticated' });
            return;
        }
        if (!recipientUserId || typeof recipientUserId !== 'string') {
            socket.emit('chat-error', { message: 'Invalid recipient' });
            return;
        }
        if (!ciphertext || typeof ciphertext !== 'string') {
            socket.emit('chat-error', { message: 'Invalid ciphertext' });
            return;
        }
        if (ciphertext.length > this.config.security.maxMessageLength * 4) {
            socket.emit('chat-error', { message: 'Encrypted message too large' });
            return;
        }
        if (type !== 1 && type !== 3) {
            socket.emit('chat-error', { message: 'Invalid message type (must be 1 or 3)' });
            return;
        }
        if (typeof registrationId !== 'number' || registrationId < 0) {
            socket.emit('chat-error', { message: 'Invalid registration ID' });
            return;
        }

        const sanitizedRecipientId = sanitizeInput(recipientUserId);
        const recipientSocket = this.findSocketByUserId(sanitizedRecipientId);

        if (!recipientSocket) {
            this._queueMessage(socket, user, sanitizedRecipientId, { ciphertext, type, registrationId });
            return;
        }

        if (!socket.roomId || !recipientSocket.roomId || socket.roomId !== recipientSocket.roomId) {
            socket.emit('chat-error', { message: 'Users not in same room' });
            return;
        }

        const message: ChatMessage = {
            id: crypto.randomBytes(16).toString('hex'),
            senderUserId: socket.userId,
            senderPeerId: user.peerId,
            senderAlias: user.alias,
            ciphertext: sanitizeInput(ciphertext),
            type,
            registrationId,
            timestamp: new Date().toISOString()
        };

        recipientSocket.emit('encrypted-chat-message', message);

        socket.emit('message-delivered', {
            messageId: message.id,
            recipientUserId: sanitizedRecipientId
        });
    }

    private _queueMessage(
        socket: AuthenticatedSocket,
        user: { peerId: string; alias: string },
        sanitizedRecipientId: string,
        { ciphertext, type, registrationId }: QueuedMessagePayload
    ): void {
        if (!this.messageQueues.has(sanitizedRecipientId)) {
            this.messageQueues.set(sanitizedRecipientId, []);
        }

        const queue = this.messageQueues.get(sanitizedRecipientId)!;

        if (queue.length >= this.config.security.maxQueuedMessages) {
            socket.emit('chat-error', { message: 'Recipient message queue is full' });
            return;
        }

        const queued: ChatMessage = {
            id: crypto.randomBytes(16).toString('hex'),
            senderUserId: socket.userId,
            senderPeerId: user.peerId,
            senderAlias: user.alias,
            ciphertext: sanitizeInput(ciphertext),
            type,
            registrationId,
            timestamp: new Date().toISOString(),
            queuedAt: Date.now()
        };

        queue.push(queued);

        socket.emit('message-queued', {
            messageId: queued.id,
            message: 'Recipient offline, message queued'
        });
    }

    handleRoomMessage(socket: AuthenticatedSocket, data: RoomMessageData): void {
        const { roomId, ciphertext, iv, keyId } = data;

        const user = this.roomManager.users.get(socket.id);
        if (!user) {
            socket.emit('chat-error', { message: 'Not authenticated' });
            return;
        }
        if (!roomId || !socket.roomId || socket.roomId !== roomId) {
            socket.emit('chat-error', { message: 'Not in specified room' });
            return;
        }
        if (!ciphertext || !iv || !keyId) {
            socket.emit('chat-error', { message: 'Invalid encrypted message data' });
            return;
        }
        if (typeof ciphertext !== 'string' || typeof iv !== 'string' || typeof keyId !== 'string') {
            socket.emit('chat-error', { message: 'Invalid data types' });
            return;
        }
        if (ciphertext.length > this.config.security.maxMessageLength * 4) {
            socket.emit('chat-error', { message: 'Message too large' });
            return;
        }

        const message = {
            id: crypto.randomBytes(16).toString('hex'),
            senderUserId: socket.userId,
            senderPeerId: user.peerId,
            senderAlias: user.alias,
            ciphertext: sanitizeInput(ciphertext),
            iv: sanitizeInput(iv),
            keyId: sanitizeInput(keyId),
            roomId,
            timestamp: new Date().toISOString()
        };

        socket.to(roomId).emit('room-chat-message', message);
    }
}

export default ChatHandler;