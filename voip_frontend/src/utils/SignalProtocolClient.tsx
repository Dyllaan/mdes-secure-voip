import type {
    SignedPreKeyPairType,
    PreKeyPairType,
    KeyPairType,
} from '@privacyresearch/libsignal-protocol-typescript';
import {
    SignalProtocolAddress,
    SessionBuilder,
    SessionCipher,
    KeyHelper,
} from '@privacyresearch/libsignal-protocol-typescript';
import { SignalProtocolStore } from './SignalProtocolStore';
import type { Socket } from 'socket.io-client';

interface PreKey {
    keyId: number;
    publicKey: string;
}

interface SignedPreKey {
    keyId: number;
    publicKey: string;
    signature: string;
}

interface PreKeyBundle {
    userId: string;
    registrationId: number;
    identityKey: string;
    signedPreKey: SignedPreKey;
    preKey?: PreKey | null;
}

interface EncryptedMessage {
    ciphertext: string;
    type: number;
    registrationId: number;
}

interface DecryptedMessage {
    message: string;
    senderUserId: string;
    senderAlias: string;
    timestamp: string;
}

export class SignalProtocolClient {
    private socket: Socket;
    private store: SignalProtocolStore;
    private sessions: Map<string, SessionCipher>;
    private isInitialized: boolean = false;
    private mode: 'ephemeral' | 'persistent' = 'ephemeral';
    private nextPreKeyId: number = 1;
    private readonly PREKEY_BATCH_SIZE = 100;

    onMessageDecrypted?: (message: DecryptedMessage) => void;

    constructor(_userId: string, socket: Socket) {
        this.socket = socket;
        this.sessions = new Map();
        this.store = new SignalProtocolStore();
    }

    async initialize(mode: 'ephemeral' | 'persistent' = 'ephemeral'): Promise<void> {
        if (this.isInitialized) {
            console.log('Signal Protocol already initialized');
            return;
        }

        try {
            console.log(`Initializing Signal Protocol in ${mode} mode...`);

            let identityKeyPair: KeyPairType;
            let registrationId: number;
            let signedPreKey: SignedPreKeyPairType;
            let preKeys: PreKeyPairType[];
            let isRestoredIdentity = false;

            if (mode === 'persistent') {
                const existingIdentity = await this.store.getIdentityKeyPair();
                const existingRegId = await this.store.getLocalRegistrationId();

                if (existingIdentity && existingRegId) {
                    console.log('Restoring existing Signal identity from IndexedDB...');
                    identityKeyPair = existingIdentity;
                    registrationId = existingRegId;
                    isRestoredIdentity = true;

                    signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
                    await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

                    preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
                    for (const preKey of preKeys) {
                        await this.store.storePreKey(preKey.keyId, preKey.keyPair);
                    }
                } else {
                    console.log('No existing identity found, generating new persistent identity...');
                    identityKeyPair = await KeyHelper.generateIdentityKeyPair();
                    registrationId = KeyHelper.generateRegistrationId();
                    await this.store.initialize(identityKeyPair, registrationId);

                    signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
                    await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

                    preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
                    for (const preKey of preKeys) {
                        await this.store.storePreKey(preKey.keyId, preKey.keyPair);
                    }
                }
            } else {
                console.log('Generating fresh ephemeral identity...');
                identityKeyPair = await KeyHelper.generateIdentityKeyPair();
                registrationId = KeyHelper.generateRegistrationId();
                await this.store.initialize(identityKeyPair, registrationId);

                signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
                await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

                preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
                for (const preKey of preKeys) {
                    await this.store.storePreKey(preKey.keyId, preKey.keyPair);
                }
            }

            await this.registerKeysWithServer(identityKeyPair.pubKey, signedPreKey, preKeys);
            this.setupSocketListeners();

            this.isInitialized = true;
            this.mode = mode;

            console.log(isRestoredIdentity
                ? 'Signal Protocol initialized (restored persistent identity)'
                : `Signal Protocol initialized (new ${mode} identity)`
            );
        } catch (error) {
            console.error('Failed to initialize Signal Protocol:', error);
            throw error;
        }
    }

    private async generatePreKeys(count: number): Promise<PreKeyPairType[]> {
        const preKeys: PreKeyPairType[] = [];
        for (let i = 0; i < count; i++) {
            preKeys.push(await KeyHelper.generatePreKey(this.nextPreKeyId + i));
        }
        this.nextPreKeyId += count;
        return preKeys;
    }

    private async registerKeysWithServer(
        identityPublicKey: ArrayBuffer,
        signedPreKey: SignedPreKeyPairType,
        preKeys: PreKeyPairType[]
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const registrationId = await this.store.getLocalRegistrationId();
            if (!registrationId) {
                reject(new Error('Registration ID not available'));
                return;
            }

            this.socket.emit('signal-register-keys', {
                identityKey: this.arrayBufferToBase64(identityPublicKey),
                signedPreKey: {
                    keyId: signedPreKey.keyId,
                    publicKey: this.arrayBufferToBase64(signedPreKey.keyPair.pubKey),
                    signature: this.arrayBufferToBase64(signedPreKey.signature),
                },
                preKeys: preKeys.map(pk => ({
                    keyId: pk.keyId,
                    publicKey: this.arrayBufferToBase64(pk.keyPair.pubKey),
                })),
                registrationId,
            });

            this.socket.once('signal-keys-registered', ({ prekeyCount }) => {
                console.log(`Keys registered: ${prekeyCount} pre-keys`);
                resolve();
            });
            this.socket.once('signal-error', (error) => {
                console.error('Key registration failed:', error);
                reject(new Error(error.message));
            });
            setTimeout(() => reject(new Error('Key registration timeout')), 10000);
        });
    }

    private setupSocketListeners(): void {
        this.socket.on('signal-prekeys-low', async ({ remaining }) => {
            console.log(`Pre-keys running low: ${remaining} remaining`);
            await this.refreshPreKeys();
        });

        this.socket.on('encrypted-chat-message', async (data) => {
            await this.handleEncryptedMessage(data);
        });

        this.socket.on('queued-messages', async ({ messages }) => {
            console.log(`Received ${messages.length} queued messages`);
            for (const message of messages) {
                await this.handleEncryptedMessage(message);
            }
        });
    }

    private async refreshPreKeys(): Promise<void> {
        try {
            const preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
            for (const preKey of preKeys) {
                await this.store.storePreKey(preKey.keyId, preKey.keyPair);
            }

            return new Promise((resolve, reject) => {
                this.socket.emit('signal-refresh-prekeys', {
                    preKeys: preKeys.map(pk => ({
                        keyId: pk.keyId,
                        publicKey: this.arrayBufferToBase64(pk.keyPair.pubKey),
                    })),
                });
                this.socket.once('signal-prekeys-refreshed', ({ totalPrekeys }) => {
                    console.log(`Pre-keys refreshed. Total: ${totalPrekeys}`);
                    resolve();
                });
                this.socket.once('signal-error', (error) => {
                    reject(new Error(error.message));
                });
            });
        } catch (error) {
            console.error('Failed to refresh pre-keys:', error);
        }
    }

    private async requestPreKeyBundle(recipientUserId: string): Promise<PreKeyBundle> {
        return new Promise((resolve, reject) => {
            this.socket.emit('signal-request-bundle', { recipientUserId });
            this.socket.once('signal-prekey-bundle', (bundle: PreKeyBundle) => resolve(bundle));
            this.socket.once('signal-error', (error) => reject(new Error(error.message)));
            setTimeout(() => reject(new Error('Pre-key bundle request timeout')), 10000);
        });
    }

    private async buildSession(recipientUserId: string, bundle: PreKeyBundle): Promise<SessionCipher> {
        const address = new SignalProtocolAddress(recipientUserId, 1);
        const sessionBuilder = new SessionBuilder(this.store, address);

        await sessionBuilder.processPreKey({
            registrationId: bundle.registrationId,
            identityKey: this.base64ToArrayBuffer(bundle.identityKey),
            signedPreKey: {
                keyId: bundle.signedPreKey.keyId,
                publicKey: this.base64ToArrayBuffer(bundle.signedPreKey.publicKey),
                signature: this.base64ToArrayBuffer(bundle.signedPreKey.signature),
            },
            preKey: bundle.preKey ? {
                keyId: bundle.preKey.keyId,
                publicKey: this.base64ToArrayBuffer(bundle.preKey.publicKey),
            } : undefined,
        });

        const sessionCipher = new SessionCipher(this.store, address);
        this.sessions.set(recipientUserId, sessionCipher);
        console.log(`Session established with ${recipientUserId}`);
        return sessionCipher;
    }

    async encryptMessage(recipientUserId: string, message: string): Promise<EncryptedMessage> {
        if (!this.isInitialized) throw new Error('Signal Protocol not initialized');

        let sessionCipher = this.sessions.get(recipientUserId);
        if (!sessionCipher) {
            const bundle = await this.requestPreKeyBundle(recipientUserId);
            sessionCipher = await this.buildSession(recipientUserId, bundle);
        }

        const plaintext = new TextEncoder().encode(message);
        const ciphertext = await sessionCipher.encrypt(plaintext.buffer);
        const registrationId = await this.store.getLocalRegistrationId();
        const body = ciphertext.body;

        if (!body) throw new Error('Encryption failed - no ciphertext body');

        return {
            ciphertext: typeof body === 'string' ? body : this.arrayBufferToBase64(body as ArrayBuffer),
            type: ciphertext.type,
            registrationId: ciphertext.registrationId || registrationId || 0,
        };
    }

    async decryptMessage(senderUserId: string, encryptedData: EncryptedMessage): Promise<string> {
        if (!this.isInitialized) throw new Error('Signal Protocol not initialized');

        const address = new SignalProtocolAddress(senderUserId, 1);
        const sessionCipher = new SessionCipher(this.store, address);
        let plaintext: ArrayBuffer;

        if (encryptedData.type === 1) {
            plaintext = await sessionCipher.decryptPreKeyWhisperMessage(
                this.base64ToArrayBuffer(encryptedData.ciphertext), 'binary'
            );
            this.sessions.set(senderUserId, sessionCipher);
        } else if (encryptedData.type === 3) {
            plaintext = await sessionCipher.decryptWhisperMessage(
                this.base64ToArrayBuffer(encryptedData.ciphertext), 'binary'
            );
        } else {
            throw new Error(`Unknown message type: ${encryptedData.type}`);
        }

        return new TextDecoder().decode(plaintext);
    }

    private async handleEncryptedMessage(data: any): Promise<void> {
        try {
            const message = await this.decryptMessage(data.senderUserId, {
                ciphertext: data.ciphertext,
                type: data.type,
                registrationId: data.registrationId,
            });
            this.onMessageDecrypted?.({
                message,
                senderUserId: data.senderUserId,
                senderAlias: data.senderAlias,
                timestamp: data.timestamp,
            });
        } catch (error) {
            console.error('Failed to handle encrypted message:', error);
        }
    }

    async sendEncryptedMessage(recipientUserId: string, message: string): Promise<void> {
        const encrypted = await this.encryptMessage(recipientUserId, message);

        return new Promise((resolve, reject) => {
            this.socket.emit('encrypted-chat-message', {
                recipientUserId,
                ciphertext: encrypted.ciphertext,
                type: encrypted.type,
                registrationId: encrypted.registrationId,
            });
            this.socket.once('message-delivered', () => resolve());
            this.socket.once('message-queued', () => resolve());
            this.socket.once('chat-error', (error) => reject(new Error(error.message)));
            setTimeout(() => reject(new Error('Message send timeout')), 10000);
        });
    }

    isReady(): boolean {
        return this.isInitialized;
    }

    cleanup(): void {
        this.sessions.clear();
        this.isInitialized = false;
        if (this.mode === 'ephemeral') this.store.clearAll();
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
}