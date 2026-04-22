/**
 * Orchestrates E2E encryption for persistent channel messages.
 * Uses P-256 ECDH + HKDF-SHA256 (ECIES) for key distribution
 * and AES-256-GCM for message encryption with AAD binding.
 */

import type {
    MemberDeviceKey,
    ChannelKeyBundle,
    PostKeyBundlesPayload,
} from '@/types/hub.types';
import { bufToBase64, base64ToBuf } from '@/crypto/base64';
import {
    buildAAD,
    generateAesKey,
    eciesWrap,
    eciesUnwrap,
} from '@/crypto/channelCrypto';
import { ChannelKeyNotFoundError } from '@/crypto/errors';
import { CryptKeyStorage } from '@/utils/crypto/CryptKeyStorage';
import type { HubApi } from '@/hooks/hub/useHubApi';

interface EncryptedPayload {
    ciphertext: string;
    iv: string;
    keyVersion: string;
}

interface KeyDistributedEvent {
    hubId: string;
    channelId: string;
    newVersion: number;
}

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

    static async create(userId: string, hubAPI: HubApi, hubIds: string[]): Promise<CryptKeyManager> {
        const storage = await CryptKeyStorage.open(userId);
        const deviceId = await storage.getOrCreateDeviceId();
        const { keyPair, publicKeySpki } = await storage.getOrCreateEcdhKeyPair();

        const manager = new CryptKeyManager(storage, deviceId, keyPair, publicKeySpki);

        await Promise.all(
            hubIds.map(hubId =>
                hubAPI.registerDeviceKey(hubId, deviceId, publicKeySpki).catch(err =>
                    console.warn(`[CryptKeyManager] Failed to register device key for hub ${hubId}:`, err)
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

    async registerWithHub(hubAPI: HubApi, hubId: string): Promise<void> {
        await hubAPI.registerDeviceKey(hubId, this.deviceId, this.ecdhPublicKeySpki);
    }

    async encrypt(
        channelId: string,
        hubId: string,
        senderId: string,
        plaintext: string,
        hubAPI: HubApi,
        onKeyDistributed?: (event: KeyDistributedEvent) => void,
    ): Promise<EncryptedPayload> {
        let version = await this.storage.getCurrentVersion(channelId);

        if (version === null) {
            version = await this.generateAndDistributeKey(channelId, hubId, hubAPI);
            onKeyDistributed?.({ hubId, channelId, newVersion: version });
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
        hubId: string,
        hubAPI: HubApi,
    ): Promise<string | null> {
        const version = parseInt(payload.keyVersion, 10);
        if (isNaN(version)) return null;

        let channelKey = await this.storage.loadChannelKey(channelId, version);

        if (!channelKey) {
            await this.syncKeyBundles(hubId, channelId, hubAPI).catch(() => {});
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
        hubId: string,
        channelId: string | undefined,
        hubAPI: HubApi,
    ): Promise<void> {
        const bundles: ChannelKeyBundle[] = await hubAPI.getKeyBundles(hubId, channelId);

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
        hubId: string,
        hubAPI: HubApi,
    ): Promise<void> {
        const currentVersion = await this.storage.getCurrentVersion(channelId);
        const newVersion = (currentVersion ?? 0) + 1;

        const newKey = await generateAesKey();
        await this.storage.storeChannelKey(channelId, newVersion, newKey);
        await this.storage.setCurrentVersion(channelId, newVersion);

        const deviceKeys: MemberDeviceKey[] = await hubAPI.getDeviceKeys(hubId);
        await this.distributeKey(channelId, hubId, newVersion, newKey, deviceKeys, hubAPI);
        await hubAPI.clearRotationNeeded(hubId, channelId).catch(() => {});
    }

    private async generateAndDistributeKey(
        channelId: string,
        hubId: string,
        hubAPI: HubApi,
    ): Promise<number> {
        const version = 1;
        const channelKey = await generateAesKey();
        await this.storage.storeChannelKey(channelId, version, channelKey);
        await this.storage.setCurrentVersion(channelId, version);

        const deviceKeys: MemberDeviceKey[] = await hubAPI.getDeviceKeys(hubId);
        await this.distributeKey(channelId, hubId, version, channelKey, deviceKeys, hubAPI);

        return version;
    }

    private async distributeKey(
        channelId: string,
        hubId: string,
        version: number,
        channelKey: CryptoKey,
        deviceKeys: MemberDeviceKey[],
        hubAPI: HubApi,
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

        await hubAPI.postKeyBundles(hubId, payload);
    }

    /**
     * Call this when a new member joins the hub to distribute the current channel
     * key to any of their devices that don't have a bundle yet.
     * Returns true if new bundles were created.
     */
    async topUpChannelKey(
        channelId: string,
        hubId: string,
        hubAPI: HubApi,
        onKeyDistributed?: (event: KeyDistributedEvent) => void,
    ): Promise<void> {
        const version = await this.storage.getCurrentVersion(channelId);
        if (version === null) return; // key not yet generated for this channel
        const channelKey = await this.storage.loadChannelKey(channelId, version);
        if (!channelKey) return;
        const topped = await this.topUpDistribution(channelId, hubId, version, channelKey, hubAPI);
        if (topped) onKeyDistributed?.({ hubId, channelId, newVersion: version });
    }

    /**
     * Checks if there are hub member devices that don't have a key bundle for
     * the given channel version, and distributes the key to them.
     * Returns true if new bundles were created.
     */
    private async topUpDistribution(
        channelId: string,
        hubId: string,
        version: number,
        channelKey: CryptoKey,
        hubAPI: HubApi,
    ): Promise<boolean> {
        const [deviceKeys, existingBundles] = await Promise.all([
            hubAPI.getDeviceKeys(hubId),
            hubAPI.getKeyBundles(hubId, channelId),
        ]);

        // Find devices that already have a bundle for this channel+version
        const coveredDeviceIds = new Set(
            existingBundles
                .filter(b => b.keyVersion === version)
                .map(b => `${b.recipientUserId}:${b.recipientDeviceId}`)
        );

        // only devices missing a bundle
        const missingDevices = deviceKeys.filter(
            dk => !coveredDeviceIds.has(`${dk.userId}:${dk.deviceId}`)
        );

        if (missingDevices.length === 0) return false;

        console.log(`[CryptKeyManager] Top-up: distributing key to ${missingDevices.length} new device(s) for channel ${channelId}`);
        await this.distributeKey(channelId, hubId, version, channelKey, missingDevices, hubAPI);
        return true;
    }
}