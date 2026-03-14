/**
 * Orchestrates E2E encryption for persistent channel messages.
 * Uses P-256 ECDH + HKDF-SHA256 (ECIES) for key distribution
 * and AES-256-GCM for message encryption with AAD binding.
 */

import type {
    MemberDeviceKey,
    ChannelKeyBundle,
    PostKeyBundlesPayload,
} from '@/types/server.types';
import { bufToBase64, base64ToBuf } from '@/crypto/base64';
import {
    buildAAD,
    generateAesKey,
    eciesWrap,
    eciesUnwrap,
} from '@/crypto/channelCrypto';
import { ChannelKeyNotFoundError } from '@/crypto/errors';
import { CryptKeyStorage } from '@/utils/CryptKeyStorage';

export interface EncryptedPayload {
    ciphertext: string;
    iv: string;
    keyVersion: string;
}

type ServerAPI = {
    registerDeviceKey(serverId: string, deviceId: string, publicKey: string): Promise<unknown>;
    getDeviceKeys(serverId: string): Promise<MemberDeviceKey[]>;
    postKeyBundles(serverId: string, payload: PostKeyBundlesPayload): Promise<unknown>;
    getKeyBundles(serverId: string, channelId?: string): Promise<ChannelKeyBundle[]>;
    clearRotationNeeded(serverId: string, channelId: string): Promise<unknown>;
};

export class CryptKeyManager {
    private storage: CryptKeyStorage;
    private deviceId: string;
    private ecdhKeyPair: CryptoKeyPair;
    private ecdhPublicKeySpki: string;

    private constructor(
        storage: CryptKeyStorage,
        deviceId: string,
        ecdhKeyPair: CryptoKeyPair,
        ecdhPublicKeySpki: string,
    ) {
        this.storage = storage;
        this.deviceId = deviceId;
        this.ecdhKeyPair = ecdhKeyPair;
        this.ecdhPublicKeySpki = ecdhPublicKeySpki;
    }

    static async create(serverAPI: ServerAPI, serverIds: string[]): Promise<CryptKeyManager> {
        const storage = await CryptKeyStorage.open();
        const deviceId = await storage.getOrCreateDeviceId();
        const { keyPair, publicKeySpki } = await storage.getOrCreateEcdhKeyPair();

        const manager = new CryptKeyManager(storage, deviceId, keyPair, publicKeySpki);

        await Promise.all(
            serverIds.map(sid =>
                serverAPI.registerDeviceKey(sid, deviceId, publicKeySpki).catch(err =>
                    console.warn(`[CryptKeyManager] Failed to register device key for server ${sid}:`, err)
                )
            )
        );

        return manager;
    }

    getDeviceId(): string {
        return this.deviceId;
    }

    getPublicKeySpki(): string {
        return this.ecdhPublicKeySpki;
    }

    async registerWithServer(serverAPI: ServerAPI, serverId: string): Promise<void> {
        await serverAPI.registerDeviceKey(serverId, this.deviceId, this.ecdhPublicKeySpki);
    }

    async encrypt(
        channelId: string,
        serverId: string,
        senderId: string,
        plaintext: string,
        serverAPI: ServerAPI,
    ): Promise<EncryptedPayload> {
        let version = await this.storage.getCurrentVersion(channelId);

        if (version === null) {
            version = await this.generateAndDistributeKey(channelId, serverId, serverAPI);
        }

        const channelKey = await this.storage.loadChannelKey(channelId, version);
        if (!channelKey) throw new ChannelKeyNotFoundError(channelId, version);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const aad = buildAAD(channelId, version, senderId);
        const plaintextBuf = new TextEncoder().encode(plaintext);

        const ciphertextBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: aad },
            channelKey,
            plaintextBuf,
        );

        return {
            ciphertext: bufToBase64(ciphertextBuf),
            iv: bufToBase64(iv.buffer),
            keyVersion: String(version),
        };
    }

    async decrypt(
        channelId: string,
        senderId: string,
        payload: EncryptedPayload,
        serverId: string,
        serverAPI: ServerAPI,
    ): Promise<string | null> {
        const version = parseInt(payload.keyVersion, 10);
        if (isNaN(version)) return null;

        let channelKey = await this.storage.loadChannelKey(channelId, version);

        if (!channelKey) {
            await this.syncKeyBundles(serverId, channelId, serverAPI).catch(() => {});
            channelKey = await this.storage.loadChannelKey(channelId, version);
        }

        if (!channelKey) return null;

        try {
            const ciphertextBuf = base64ToBuf(payload.ciphertext);
            const iv = new Uint8Array(base64ToBuf(payload.iv));
            const aad = buildAAD(channelId, version, senderId);

            const plaintextBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, additionalData: aad },
                channelKey,
                ciphertextBuf,
            );

            return new TextDecoder().decode(plaintextBuf);
        } catch {
            return null;
        }
    }

    async syncKeyBundles(
        serverId: string,
        channelId: string | undefined,
        serverAPI: ServerAPI,
    ): Promise<void> {
        const bundles: ChannelKeyBundle[] = await serverAPI.getKeyBundles(serverId, channelId);

        for (const bundle of bundles) {
            const existing = await this.storage.loadChannelKey(bundle.channelId, bundle.keyVersion);
            if (existing) continue;

            try {
                const channelKey = await eciesUnwrap(bundle, this.ecdhKeyPair.privateKey);
                await this.storage.storeChannelKey(bundle.channelId, bundle.keyVersion, channelKey);

                const currentVer = await this.storage.getCurrentVersion(bundle.channelId);
                if (currentVer === null || bundle.keyVersion > currentVer) {
                    await this.storage.setCurrentVersion(bundle.channelId, bundle.keyVersion);
                }
            } catch (err) {
                console.warn(
                    `[CryptKeyManager] Failed to unwrap bundle for ${bundle.channelId} v${bundle.keyVersion}:`,
                    err
                );
            }
        }
    }

    async rotateChannelKey(
        channelId: string,
        serverId: string,
        serverAPI: ServerAPI,
    ): Promise<void> {
        const currentVersion = await this.storage.getCurrentVersion(channelId);
        const newVersion = (currentVersion ?? 0) + 1;

        const newKey = await generateAesKey();
        await this.storage.storeChannelKey(channelId, newVersion, newKey);
        await this.storage.setCurrentVersion(channelId, newVersion);

        const deviceKeys: MemberDeviceKey[] = await serverAPI.getDeviceKeys(serverId);
        await this.distributeKey(channelId, serverId, newVersion, newKey, deviceKeys, serverAPI);
        await serverAPI.clearRotationNeeded(serverId, channelId).catch(() => {});
    }

    private async generateAndDistributeKey(
        channelId: string,
        serverId: string,
        serverAPI: ServerAPI,
    ): Promise<number> {
        const version = 1;
        const channelKey = await generateAesKey();
        await this.storage.storeChannelKey(channelId, version, channelKey);
        await this.storage.setCurrentVersion(channelId, version);

        const deviceKeys: MemberDeviceKey[] = await serverAPI.getDeviceKeys(serverId);
        await this.distributeKey(channelId, serverId, version, channelKey, deviceKeys, serverAPI);

        return version;
    }

    private async distributeKey(
        channelId: string,
        serverId: string,
        version: number,
        channelKey: CryptoKey,
        deviceKeys: MemberDeviceKey[],
        serverAPI: ServerAPI,
    ): Promise<void> {
        const rawKey = await crypto.subtle.exportKey('raw', channelKey);

        const bundles = await Promise.all(
            deviceKeys.map(async dk => {
                try {
                    const bundle = await eciesWrap(rawKey, dk.publicKey);
                    return {
                        recipientUserId: dk.userId,
                        recipientDeviceId: dk.deviceId,
                        senderEphemeralPub: bundle.senderEphemeralPub,
                        ciphertext: bundle.ciphertext,
                        iv: bundle.iv,
                    };
                } catch (err) {
                    console.warn(`[CryptKeyManager] Failed to wrap key for device ${dk.deviceId}:`, err);
                    return null;
                }
            })
        );

        const validBundles = bundles.filter((b): b is NonNullable<typeof b> => b !== null);
        if (validBundles.length === 0) return;

        const payload: PostKeyBundlesPayload = {
            channelId,
            keyVersion: version,
            bundles: validBundles,
        };

        await serverAPI.postKeyBundles(serverId, payload);
    }
}
