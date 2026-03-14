const { sanitizeInput } = require('../utils/sanitize');

class SignalProtocolHandler {
    constructor(parent) {
        this.signalKeys = parent.signalKeys;
        this.findSocketByUserId = parent.findSocketByUserId.bind(parent);
    }
w
    handleRegisterKeys(socket, data) {
        const { identityKey, signedPreKey, preKeys, registrationId } = data;

        if (!identityKey || !signedPreKey || !registrationId) {
            return socket.emit('signal-error', {
                message: 'Missing required key data',
                field: !identityKey ? 'identityKey' : !signedPreKey ? 'signedPreKey' : 'registrationId'
            });
        }

        if (typeof identityKey !== 'string' || identityKey.length < 20 || identityKey.length > 500) {
            return socket.emit('signal-error', { message: 'Invalid identity key format' });
        }

        if (!signedPreKey.keyId || !signedPreKey.publicKey || !signedPreKey.signature) {
            return socket.emit('signal-error', { message: 'Invalid signed pre-key structure' });
        }

        if (typeof signedPreKey.publicKey !== 'string' || signedPreKey.publicKey.length > 500) {
            return socket.emit('signal-error', { message: 'Invalid signed pre-key format' });
        }

        if (!Array.isArray(preKeys)) {
            return socket.emit('signal-error', { message: 'preKeys must be an array' });
        }

        if (preKeys.length === 0 || preKeys.length > 100) {
            return socket.emit('signal-error', { message: 'preKeys array must contain 1-100 keys' });
        }

        for (const preKey of preKeys) {
            if (!preKey.keyId || !preKey.publicKey) {
                return socket.emit('signal-error', { message: 'Invalid pre-key structure' });
            }
            if (typeof preKey.publicKey !== 'string' || preKey.publicKey.length > 500) {
                return socket.emit('signal-error', { message: 'Invalid pre-key format' });
            }
        }

        if (typeof registrationId !== 'number' || registrationId < 0 || registrationId > 16383) {
            return socket.emit('signal-error', { message: 'Invalid registration ID (must be 0-16383)' });
        }

        const keyBundle = {
            userId: socket.username,
            identityKey: sanitizeInput(identityKey),
            signedPreKey: {
                keyId: signedPreKey.keyId,
                publicKey: sanitizeInput(signedPreKey.publicKey),
                signature: sanitizeInput(signedPreKey.signature)
            },
            preKeys: new Map(preKeys.map(pk => [
                pk.keyId,
                { keyId: pk.keyId, publicKey: sanitizeInput(pk.publicKey) }
            ])),
            registrationId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.signalKeys.set(socket.username, keyBundle);

        socket.emit('signal-keys-registered', {
            success: true,
            prekeyCount: preKeys.length
        });

        console.log(`Signal keys registered for user ${socket.username} (${preKeys.length} pre-keys)`);
    }

    handleRequestBundle(socket, data) {
        const { recipientUserId } = data;

        if (!recipientUserId || typeof recipientUserId !== 'string') {
            return socket.emit('signal-error', { message: 'Invalid recipient user ID' });
        }

        const sanitizedRecipientId = sanitizeInput(recipientUserId);
        const recipientBundle = this.signalKeys.get(sanitizedRecipientId);

        if (!recipientBundle) {
            return socket.emit('signal-error', {
                message: 'Recipient has not registered Signal keys',
                recipientUserId: sanitizedRecipientId
            });
        }

        let oneTimePreKey = null;
        if (recipientBundle.preKeys.size > 0) {
            const firstKey = recipientBundle.preKeys.values().next().value;
            oneTimePreKey = { keyId: firstKey.keyId, publicKey: firstKey.publicKey };

            recipientBundle.preKeys.delete(firstKey.keyId);
            recipientBundle.updatedAt = Date.now();

            console.log(`Pre-key consumed for user ${recipientBundle.userId} (${recipientBundle.preKeys.size} remaining)`);

            if (recipientBundle.preKeys.size < 10) {
                const recipientSocket = this.findSocketByUserId(sanitizedRecipientId);
                if (recipientSocket) {
                    recipientSocket.emit('signal-prekeys-low', {
                        remaining: recipientBundle.preKeys.size
                    });
                }
            }
        }

        socket.emit('signal-prekey-bundle', {
            userId: recipientBundle.userId,
            registrationId: recipientBundle.registrationId,
            identityKey: recipientBundle.identityKey,
            signedPreKey: {
                keyId: recipientBundle.signedPreKey.keyId,
                publicKey: recipientBundle.signedPreKey.publicKey,
                signature: recipientBundle.signedPreKey.signature
            },
            preKey: oneTimePreKey
        });
    }

    handleRefreshPrekeys(socket, data) {
        const { preKeys } = data;

        if (!Array.isArray(preKeys) || preKeys.length === 0 || preKeys.length > 100) {
            return socket.emit('signal-error', { message: 'Invalid pre-keys array (must contain 1-100 keys)' });
        }

        for (const preKey of preKeys) {
            if (!preKey.keyId || !preKey.publicKey) {
                return socket.emit('signal-error', { message: 'Invalid pre-key structure' });
            }
            if (typeof preKey.publicKey !== 'string' || preKey.publicKey.length > 500) {
                return socket.emit('signal-error', { message: 'Invalid pre-key format' });
            }
        }

        const bundle = this.signalKeys.get(socket.username);
        if (!bundle) {
            return socket.emit('signal-error', { message: 'No key bundle found. Register keys first.' });
        }

        for (const preKey of preKeys) {
            bundle.preKeys.set(preKey.keyId, {
                keyId: preKey.keyId,
                publicKey: sanitizeInput(preKey.publicKey)
            });
        }

        bundle.updatedAt = Date.now();

        socket.emit('signal-prekeys-refreshed', {
            success: true,
            totalPrekeys: bundle.preKeys.size
        });

        console.log(`Pre-keys refreshed for user ${socket.username} (total: ${bundle.preKeys.size})`);
    }
}

module.exports = SignalProtocolHandler;