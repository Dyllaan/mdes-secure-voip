const { sanitizeInput } = require('../utils/sanitize');


class RoomKeyHandler {
    constructor(parent) {
        this.rsaPublicKeys = parent.rsaPublicKeys;
        this.roomManager = parent.roomManager;
        this.findSocketByUserId = parent.findSocketByUserId.bind(parent);
    }

    handleRegisterRSAKey(socket, data) {
        const { publicKey } = data;

        if (!publicKey || typeof publicKey !== 'string') {
            return socket.emit('signal-error', { message: 'Invalid RSA public key' });
        }

        if (publicKey.length > 1000) {
            return socket.emit('signal-error', { message: 'RSA public key too large' });
        }

        this.rsaPublicKeys.set(socket.userId, sanitizeInput(publicKey));

        console.log(`RSA public key registered for user ${socket.username}`);

        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-rsa-key', {
                userId: socket.userId,
                publicKey: sanitizeInput(publicKey)
            });
        }

        socket.emit('rsa-key-registered', { success: true });
    }

    handleRequestRSAKey(socket, data) {
        const { userId } = data;

        if (!userId || typeof userId !== 'string') {
            return socket.emit('signal-error', { message: 'Invalid user ID' });
        }

        const publicKey = this.rsaPublicKeys.get(userId);

        if (!publicKey) {
            return socket.emit('signal-error', { message: 'RSA public key not found for user' });
        }

        socket.emit('user-rsa-key', { userId, publicKey: sanitizeInput(publicKey) });

        console.log(`RSA public key sent: ${userId} → ${socket.username}`);
    }

    handleRoomKeyRequest(socket, data) {
        const { roomId, fromUserId } = data;

        if (!roomId || !socket.roomId || socket.roomId !== roomId) {
            return socket.emit('signal-error', { message: 'Not in specified room' });
        }

        const providerSocket = this.findSocketByUserId(fromUserId);

        if (!providerSocket) {
            return socket.emit('signal-error', { message: 'Key provider not found' });
        }

        providerSocket.emit('request-room-key', {
            roomId,
            requesterId: socket.userId
        });

        console.log(`Room key requested: ${socket.username} from ${providerSocket.username}`);
    }

    handleRoomKeyResponse(socket, data) {
        const { roomId, requesterId, encryptedKey, keyId } = data;

        if (!roomId || !socket.roomId || socket.roomId !== roomId) {
            return socket.emit('signal-error', { message: 'Not in specified room' });
        }

        const requesterSocket = this.findSocketByUserId(requesterId);

        if (!requesterSocket) {
            return socket.emit('signal-error', { message: 'Requester not found' });
        }

        requesterSocket.emit('room-key-response', { 
            encryptedKey: sanitizeInput(encryptedKey),
            keyId: sanitizeInput(keyId)
        });

        console.log(`Room key delivered: ${socket.username} → ${requesterSocket.username}`);
    }
}

module.exports = RoomKeyHandler;