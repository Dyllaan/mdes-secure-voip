import type { Socket } from 'socket.io-client';

export interface DecryptedRoomMessage {
    message: string;
    senderUserId: string;
    senderAlias: string;
    timestamp: string;
}

interface RoomKey {
    key: CryptoKey;
    keyId: string;
}

export class RoomClient {
    private socket: Socket;
    private rsaKeyPair: CryptoKeyPair | null = null;
    private userPublicKeys: Map<string, CryptoKey> = new Map();
    private roomKeys: Map<string, RoomKey> = new Map();
    private currentRoomId: string | null = null;

    onRoomMessageDecrypted?: (message: DecryptedRoomMessage) => void;

    constructor(socket: Socket) {
        this.socket = socket;
    }

    async initialize(): Promise<void> {
        await this.generateAndRegisterRSAKey();
        this.setupListeners();
    }

    private async generateAndRegisterRSAKey(): Promise<void> {
        this.rsaKeyPair = await crypto.subtle.generateKey(
            { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
            true,
            ['encrypt', 'decrypt']
        );

        const exported = await crypto.subtle.exportKey('spki', this.rsaKeyPair.publicKey);
        const publicKeyBase64 = this.arrayBufferToBase64(exported);

        return new Promise((resolve, reject) => {
            this.socket.emit('register-rsa-key', { publicKey: publicKeyBase64 });
            this.socket.once('rsa-key-registered', () => resolve());
            setTimeout(() => reject(new Error('RSA key registration timeout')), 5000);
        });
    }

    private setupListeners(): void {
        this.socket.on('user-rsa-key', async ({ userId, publicKey }: { userId: string; publicKey: string }) => {
            try {
                const key = await crypto.subtle.importKey(
                    'spki',
                    this.base64ToArrayBuffer(publicKey),
                    { name: 'RSA-OAEP', hash: 'SHA-256' },
                    true,
                    ['encrypt']
                );
                this.userPublicKeys.set(userId, key);
                console.log('[RoomClient] RSA public key updated for', userId);
            } catch (err) {
                console.error('[RoomClient] Failed to import RSA public key:', err);
            }
        });

        this.socket.on('request-room-key', async (data: { roomId: string; requesterId: string }) => {
            await this.handleRoomKeyRequest(data);
        });

        this.socket.on('room-chat-message', async (data) => {
            await this.handleIncomingMessage(data);
        });
    }

    async joinRoom(roomId: string, existingUsers: string[]): Promise<void> {
        this.currentRoomId = roomId;

        if (existingUsers.length === 0) {
            // Room is empty or only bots present so generate a fresh key.
            const key = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
            );
            this.roomKeys.set(roomId, { key, keyId: crypto.randomUUID() });
            console.log('Room key generated');
        } else {
            await this.requestRoomKey(roomId, existingUsers[0]);
        }
    }

    private async requestRoomKey(roomId: string, fromUserId: string): Promise<void> {
        let attempts = 0;
        while (!this.userPublicKeys.has(fromUserId) && attempts < 20) {
            await new Promise(r => setTimeout(r, 250));
            attempts++;
        }
        if (!this.userPublicKeys.has(fromUserId)) {
            throw new Error(`RSA public key not available for ${fromUserId}`);
        }

        return new Promise((resolve, reject) => {
            this.socket.emit('request-room-key', { roomId, fromUserId });

            const onResponse = async (data: { encryptedKey: string; keyId: string }) => {
                try {
                    const decrypted = await crypto.subtle.decrypt(
                        { name: 'RSA-OAEP' },
                        this.rsaKeyPair!.privateKey,
                        this.base64ToArrayBuffer(data.encryptedKey)
                    );
                    const jwk = JSON.parse(new TextDecoder().decode(decrypted));
                    const key = await crypto.subtle.importKey(
                        'jwk', jwk, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
                    );
                    this.roomKeys.set(roomId, { key, keyId: data.keyId });
                    console.log('Room key received and decrypted');
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };

            this.socket.once('room-key-response', onResponse);
            setTimeout(() => {
                this.socket.off('room-key-response', onResponse);
                reject(new Error('Room key request timeout'));
            }, 10000);
        });
    }

    private async handleRoomKeyRequest(data: { roomId: string; requesterId: string }): Promise<void> {
        const roomKey = this.roomKeys.get(data.roomId);
        if (!roomKey) {
            console.error('[RoomClient] No room key to share for', data.roomId);
            return;
        }

        let requesterKey = this.userPublicKeys.get(data.requesterId);
        let attempts = 0;
        while (!requesterKey && attempts < 20) {
            await new Promise(r => setTimeout(r, 250));
            requesterKey = this.userPublicKeys.get(data.requesterId);
            attempts++;
        }
        if (!requesterKey) {
            console.error('[RoomClient] Timeout waiting for RSA key from', data.requesterId);
            return;
        }

        try {
            const jwk = await crypto.subtle.exportKey('jwk', roomKey.key);
            const encrypted = await crypto.subtle.encrypt(
                { name: 'RSA-OAEP' },
                requesterKey,
                new TextEncoder().encode(JSON.stringify(jwk))
            );

            this.socket.emit('room-key-response', {
                roomId: data.roomId,
                requesterId: data.requesterId,
                encryptedKey: this.arrayBufferToBase64(encrypted),
                keyId: roomKey.keyId,
            });

            console.log('[RoomClient] Room key sent to', data.requesterId);
        } catch (err) {
            console.error('[RoomClient] Failed to send room key:', err);
        }
    }

    async sendMessage(message: string): Promise<void> {
        if (!this.currentRoomId) throw new Error('Not in a room');
        const roomKey = this.roomKeys.get(this.currentRoomId);
        if (!roomKey) throw new Error('No room key available');

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            roomKey.key,
            new TextEncoder().encode(message)
        );

        this.socket.emit('room-chat-message', {
            roomId: this.currentRoomId,
            ciphertext: this.arrayBufferToBase64(encrypted),
            iv: this.arrayBufferToBase64(iv.buffer),
            keyId: roomKey.keyId,
        });
    }

    private async handleIncomingMessage(data: {
        senderUserId: string;
        senderAlias: string;
        ciphertext: string;
        iv: string;
        keyId: string;
        roomId: string;
        timestamp: string;
    }): Promise<void> {
        const roomKey = this.roomKeys.get(data.roomId);
        if (!roomKey || roomKey.keyId !== data.keyId) return;

        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: new Uint8Array(this.base64ToArrayBuffer(data.iv)) },
                roomKey.key,
                this.base64ToArrayBuffer(data.ciphertext)
            );
            this.onRoomMessageDecrypted?.({
                message: new TextDecoder().decode(decrypted),
                senderUserId: data.senderUserId,
                senderAlias: data.senderAlias,
                timestamp: data.timestamp,
            });
        } catch (err) {
            console.error('[RoomClient] Failed to decrypt message:', err);
        }
    }

    leaveRoom(): void {
        if (this.currentRoomId) {
            this.roomKeys.delete(this.currentRoomId);
            this.currentRoomId = null;
        }
    }

    cleanup(): void {
        this.roomKeys.clear();
        this.currentRoomId = null;
        this.userPublicKeys.clear();
        this.socket.off('user-rsa-key');
        this.socket.off('request-room-key');
        this.socket.off('room-chat-message');
    }

    isRoomReady(): boolean {
        return this.currentRoomId !== null && this.roomKeys.has(this.currentRoomId);
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