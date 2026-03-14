const crypto = require('crypto');
const { sanitizeInput } = require('../utils/sanitize');

class ChatHandler {
    constructor(parent) {
        this.config = parent.config;
        this.messageQueues = parent.messageQueues;
        this.roomManager = parent.roomManager;
        this.findSocketByUserId = parent.findSocketByUserId.bind(parent);
    }d

    handleEncryptedMessage(socket, data) {
        const { recipientUserId, ciphertext, type, registrationId } = data;

        const user = this.roomManager.users.get(socket.id);
        if (!user) {
            return socket.emit('chat-error', { message: 'Not authenticated' });
        }

        if (!recipientUserId || typeof recipientUserId !== 'string') {
            return socket.emit('chat-error', { message: 'Invalid recipient' });
        }

        if (!ciphertext || typeof ciphertext !== 'string') {
            return socket.emit('chat-error', { message: 'Invalid ciphertext' });
        }

        if (ciphertext.length > this.config.security.maxMessageLength * 4) {
            return socket.emit('chat-error', { message: 'Encrypted message too large' });
        }

        if (type !== 1 && type !== 3) {
            return socket.emit('chat-error', { message: 'Invalid message type (must be 1 or 3)' });
        }

        if (typeof registrationId !== 'number' || registrationId < 0) {
            return socket.emit('chat-error', { message: 'Invalid registration ID' });
        }

        const sanitizedRecipientId = sanitizeInput(recipientUserId);
        const recipientSocket = this.findSocketByUserId(sanitizedRecipientId);

        if (!recipientSocket) {
            return this._queueMessage(socket, user, sanitizedRecipientId, { ciphertext, type, registrationId });
        }

        if (socket.roomId && recipientSocket.roomId && socket.roomId !== recipientSocket.roomId) {
            return socket.emit('chat-error', { message: 'Users not in same room' });
        }

        const message = {
            id: crypto.randomBytes(8).toString('hex'),
            senderUserId: socket.username,
            senderPeerId: user.peerId,
            senderAlias: user.alias,
            ciphertext: sanitizeInput(ciphertext),
            type,
            registrationId,
            timestamp: new Date().toISOString()
        };

        recipientSocket.emit('encrypted-chat-message', message);

        console.log(`Encrypted message sent: ${socket.username} → ${recipientSocket.username}`);

        socket.emit('message-delivered', {
            messageId: message.id,
            recipientUserId: sanitizedRecipientId
        });
    }

    _queueMessage(socket, user, sanitizedRecipientId, { ciphertext, type, registrationId }) {
        if (!this.messageQueues.has(sanitizedRecipientId)) {
            this.messageQueues.set(sanitizedRecipientId, []);
        }

        const queue = this.messageQueues.get(sanitizedRecipientId);

        if (queue.length >= this.config.security.maxQueuedMessages) {
            return socket.emit('chat-error', { message: 'Recipient message queue is full' });
        }

        const queued = {
            id: crypto.randomBytes(8).toString('hex'),
            senderUserId: socket.username,
            senderPeerId: user.peerId,
            senderAlias: user.alias,
            ciphertext: sanitizeInput(ciphertext),
            type,
            registrationId,
            timestamp: new Date().toISOString(),
            queuedAt: Date.now()
        };

        queue.push(queued);

        console.log(`Message queued for offline user ${sanitizedRecipientId} (queue size: ${queue.length})`);

        socket.emit('message-queued', {
            messageId: queued.id,
            message: 'Recipient offline, message queued'
        });
    }

    handleRoomMessage(socket, data) {
        const { roomId, ciphertext, iv, keyId } = data;

        const user = this.roomManager.users.get(socket.id);
        if (!user) {
            return socket.emit('chat-error', { message: 'Not authenticated' });
        }

        if (!roomId || !socket.roomId || socket.roomId !== roomId) {
            return socket.emit('chat-error', { message: 'Not in specified room' });
        }

        if (!ciphertext || !iv || !keyId) {
            return socket.emit('chat-error', { message: 'Invalid encrypted message data' });
        }

        if (typeof ciphertext !== 'string' || typeof iv !== 'string' || typeof keyId !== 'string') {
            return socket.emit('chat-error', { message: 'Invalid data types' });
        }

        if (ciphertext.length > this.config.security.maxMessageLength * 4) {
            return socket.emit('chat-error', { message: 'Message too large' });
        }

        const message = {
            id: crypto.randomBytes(8).toString('hex'),
            senderUserId: socket.username,
            senderPeerId: user.peerId,
            senderAlias: user.alias,
            ciphertext: sanitizeInput(ciphertext),
            iv: sanitizeInput(iv),
            keyId: sanitizeInput(keyId),
            roomId,
            timestamp: new Date().toISOString()
        };

        socket.to(roomId).emit('room-chat-message', message);

        console.log(`Room message broadcast in ${roomId} from ${socket.username}`);
    }
}

module.exports = ChatHandler;