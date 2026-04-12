import { sanitizeInput } from '../utils/sanitize';
import { SignalKeyBundle, PreKey, AuthenticatedSocket, RefreshPrekeysData, RegisterKeysData, Parent, RequestBundleData } from '../types';

class SignalProtocolHandler {
    private signalKeys: Map<string, SignalKeyBundle>;
    private findSocketByUserId: (username: string) => AuthenticatedSocket | null;

    constructor(parent: Parent) {
        this.signalKeys = parent.signalKeys;
        this.findSocketByUserId = parent.findSocketByUserId.bind(parent);
    }

    handleRegisterKeys(socket: AuthenticatedSocket, data: RegisterKeysData): void {
        const { identityKey, signedPreKey, preKeys, registrationId } = data;

        if (!identityKey || !signedPreKey || !registrationId) {
            socket.emit('signal-error', {
                message: 'Missing required key data',
                field: !identityKey ? 'identityKey' : !signedPreKey ? 'signedPreKey' : 'registrationId',
            });
            return;
        }
        if (typeof identityKey !== 'string' || identityKey.length < 20 || identityKey.length > 500) {
            socket.emit('signal-error', { message: 'Invalid identity key format' });
            return;
        }
        if (!signedPreKey.keyId || !signedPreKey.publicKey || !signedPreKey.signature) {
            socket.emit('signal-error', { message: 'Invalid signed pre-key structure' });
            return;
        }
        if (typeof signedPreKey.publicKey !== 'string' || signedPreKey.publicKey.length > 500) {
            socket.emit('signal-error', { message: 'Invalid signed pre-key format' });
            return;
        }
        if (!Array.isArray(preKeys)) {
            socket.emit('signal-error', { message: 'preKeys must be an array' });
            return;
        }
        if (preKeys.length === 0 || preKeys.length > 100) {
            socket.emit('signal-error', { message: 'preKeys array must contain 1-100 keys' });
            return;
        }
        for (const preKey of preKeys) {
            if (!preKey.keyId || !preKey.publicKey) {
                socket.emit('signal-error', { message: 'Invalid pre-key structure' });
                return;
            }
            if (typeof preKey.publicKey !== 'string' || preKey.publicKey.length > 500) {
                socket.emit('signal-error', { message: 'Invalid pre-key format' });
                return;
            }
        }
        if (typeof registrationId !== 'number' || registrationId < 0 || registrationId > 16383) {
            socket.emit('signal-error', { message: 'Invalid registration ID (must be 0-16383)' });
            return;
        }

        const now = Date.now();
        const keyBundle: SignalKeyBundle = {
            userId: socket.userId,
            identityKey: sanitizeInput(identityKey),
            signedPreKey: {
                keyId: signedPreKey.keyId,
                publicKey: sanitizeInput(signedPreKey.publicKey),
                signature: sanitizeInput(signedPreKey.signature),
            },
            preKeys: new Map(preKeys.map(pk => [
                pk.keyId,
                { keyId: pk.keyId, publicKey: sanitizeInput(pk.publicKey) },
            ])),
            registrationId,
            createdAt: now,
            updatedAt: now,
        };

        this.signalKeys.set(socket.userId, keyBundle);
        socket.emit('signal-keys-registered', { success: true, prekeyCount: preKeys.length });
    }

    handleRequestBundle(socket: AuthenticatedSocket, data: RequestBundleData): void {
        const { recipientUserId } = data;

        if (!recipientUserId || typeof recipientUserId !== 'string') {
            socket.emit('signal-error', { message: 'Invalid recipient user ID' });
            return;
        }

        const sanitizedRecipientId = sanitizeInput(recipientUserId);
        const recipientBundle = this.signalKeys.get(sanitizedRecipientId);

        if (!recipientBundle) {
            socket.emit('signal-error', {
                message: 'Recipient has not registered Signal keys',
                recipientUserId: sanitizedRecipientId,
            });
            return;
        }

        let oneTimePreKey: PreKey | null = null;
        if (recipientBundle.preKeys.size > 0) {
            const firstKey = recipientBundle.preKeys.values().next().value as PreKey;
            oneTimePreKey = { keyId: firstKey.keyId, publicKey: firstKey.publicKey };
            recipientBundle.preKeys.delete(firstKey.keyId);
            recipientBundle.updatedAt = Date.now();

            if (recipientBundle.preKeys.size < 10) {
                const recipientSocket = this.findSocketByUserId(sanitizedRecipientId);
                if (recipientSocket) {
                    recipientSocket.emit('signal-prekeys-low', { remaining: recipientBundle.preKeys.size });
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
                signature: recipientBundle.signedPreKey.signature,
            },
            preKey: oneTimePreKey,
        });
    }

    handleRefreshPrekeys(socket: AuthenticatedSocket, data: RefreshPrekeysData): void {
        const { preKeys } = data;

        if (!Array.isArray(preKeys) || preKeys.length === 0 || preKeys.length > 100) {
            socket.emit('signal-error', { message: 'Invalid pre-keys array (must contain 1-100 keys)' });
            return;
        }
        for (const preKey of preKeys) {
            if (!preKey.keyId || !preKey.publicKey) {
                socket.emit('signal-error', { message: 'Invalid pre-key structure' });
                return;
            }
            if (typeof preKey.publicKey !== 'string' || preKey.publicKey.length > 500) {
                socket.emit('signal-error', { message: 'Invalid pre-key format' });
                return;
            }
        }

        const bundle = this.signalKeys.get(socket.userId);
        if (!bundle) {
            socket.emit('signal-error', { message: 'No key bundle found. Register keys first.' });
            return;
        }

        for (const preKey of preKeys) {
            bundle.preKeys.set(preKey.keyId, {
                keyId: preKey.keyId,
                publicKey: sanitizeInput(preKey.publicKey),
            });
        }

        bundle.updatedAt = Date.now();
        socket.emit('signal-prekeys-refreshed', { success: true, totalPrekeys: bundle.preKeys.size });
    }
}

export default SignalProtocolHandler;