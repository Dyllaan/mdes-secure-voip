import { bufToBase64 } from '@/crypto/base64';
import { KeyStorageError } from '@/crypto/errors';

const DB_VERSION = 2;
const STORE_META = 'meta';
const STORE_CHANNEL_KEYS = 'channelKeys';
const META_PRIVATE_JWK = 'ecdhPrivateJwk';
const META_PUBLIC_JWK = 'ecdhPublicJwk';
const META_PUBLIC_SPKI = 'publicKeySpki';
const META_LEGACY_KEYPAIR = 'ecdhKeyPair';

interface StoredKeyMaterial {
    privateKeyJwk: JsonWebKey;
    publicKeyJwk: JsonWebKey;
    publicKeySpki: string;
}

function openIDB(userId: string): Promise<IDBDatabase> {
    const dbName = `channel-keys-v1-${userId}`;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, DB_VERSION);
        req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
            const db = req.result;
            if (e.oldVersion < 2) {
                if (db.objectStoreNames.contains(STORE_META)) db.deleteObjectStore(STORE_META);
                if (db.objectStoreNames.contains(STORE_CHANNEL_KEYS)) db.deleteObjectStore(STORE_CHANNEL_KEYS);
            }
            if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
            if (!db.objectStoreNames.contains(STORE_CHANNEL_KEYS)) db.createObjectStore(STORE_CHANNEL_KEYS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
    });
}

function idbSet(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function importStoredKeyMaterial(keyMaterial: StoredKeyMaterial): Promise<CryptoKeyPair> {
    const [publicKey, privateKey] = await Promise.all([
        crypto.subtle.importKey(
            'jwk',
            keyMaterial.publicKeyJwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [],
        ),
        crypto.subtle.importKey(
            'jwk',
            keyMaterial.privateKeyJwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            ['deriveKey', 'deriveBits'],
        ),
    ]);

    return { publicKey, privateKey };
}

export class CryptKeyStorage {
    private db: IDBDatabase;
    private keyCache = new Map<string, CryptoKey>();

    private constructor(db: IDBDatabase) {
        this.db = db;
    }

    static async open(userId: string): Promise<CryptKeyStorage> {
        return new CryptKeyStorage(await openIDB(userId));
    }

    async getOrCreateDeviceId(): Promise<string> {
        let id = await idbGet<string>(this.db, STORE_META, 'deviceId');
        if (!id) {
            id = crypto.randomUUID();
            await idbSet(this.db, STORE_META, 'deviceId', id);
        }
        return id;
    }

    async getOrCreateEcdhKeyPair(): Promise<{ keyPair: CryptoKeyPair; publicKeySpki: string }> {
        const stored = await this.loadStoredKeyMaterial();
        if (stored) {
            try {
                return {
                    keyPair: await importStoredKeyMaterial(stored),
                    publicKeySpki: stored.publicKeySpki,
                };
            } catch (error) {
                throw new KeyStorageError('Stored encryption keys could not be imported. Recover them using your mnemonic.', error);
            }
        }

        const legacyKeyPair = await idbGet<CryptoKeyPair>(this.db, STORE_META, META_LEGACY_KEYPAIR);
        if (legacyKeyPair) {
            try {
                const spkiBuf = await crypto.subtle.exportKey('spki', legacyKeyPair.publicKey);
                return {
                    keyPair: legacyKeyPair,
                    publicKeySpki: bufToBase64(spkiBuf),
                };
            } catch (error) {
                throw new KeyStorageError('Existing encryption keys use an older format that could not be loaded. Recover them using your mnemonic.', error);
            }
        }

        try {
            const generated = await crypto.subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                ['deriveKey', 'deriveBits'],
            );
            const [privateKeyJwk, publicKeyJwk, spkiBuf] = await Promise.all([
                crypto.subtle.exportKey('jwk', generated.privateKey),
                crypto.subtle.exportKey('jwk', generated.publicKey),
                crypto.subtle.exportKey('spki', generated.publicKey),
            ]);
            const keyMaterial = {
                privateKeyJwk,
                publicKeyJwk,
                publicKeySpki: bufToBase64(spkiBuf),
            };

            await this.storeKeyMaterial(keyMaterial);

            return {
                keyPair: await importStoredKeyMaterial(keyMaterial),
                publicKeySpki: keyMaterial.publicKeySpki,
            };
        } catch (error) {
            throw new KeyStorageError('Failed to generate and persist a new device keypair.', error);
        }
    }

    async loadChannelKey(channelId: string, version: number): Promise<CryptoKey | undefined> {
        const cacheKey = `${channelId}:v${version}`;
        const cached = this.keyCache.get(cacheKey);
        if (cached) return cached;
        const key = await idbGet<CryptoKey>(this.db, STORE_CHANNEL_KEYS, cacheKey);
        if (key) this.keyCache.set(cacheKey, key);
        return key;
    }

    async storeChannelKey(channelId: string, version: number, key: CryptoKey): Promise<void> {
        const cacheKey = `${channelId}:v${version}`;
        await idbSet(this.db, STORE_CHANNEL_KEYS, cacheKey, key);
        this.keyCache.set(cacheKey, key);
    }

    async getCurrentVersion(channelId: string): Promise<number | null> {
        const ver = await idbGet<number>(this.db, STORE_CHANNEL_KEYS, `${channelId}:ver`);
        return ver ?? null;
    }

    async setCurrentVersion(channelId: string, version: number): Promise<void> {
        await idbSet(this.db, STORE_CHANNEL_KEYS, `${channelId}:ver`, version);
    }

    async hasKeypair(): Promise<boolean> {
        const [privateKeyJwk, publicKeyJwk, legacyKeyPair] = await Promise.all([
            idbGet<JsonWebKey>(this.db, STORE_META, META_PRIVATE_JWK),
            idbGet<JsonWebKey>(this.db, STORE_META, META_PUBLIC_JWK),
            idbGet<CryptoKeyPair>(this.db, STORE_META, META_LEGACY_KEYPAIR),
        ]);
        return (privateKeyJwk !== undefined && publicKeyJwk !== undefined) || legacyKeyPair !== undefined;
    }

    async initFromDerived(
        identity: {
            privateKeyJwk: JsonWebKey;
            publicKeyJwk: JsonWebKey;
            publicKeySpki: string;
            deviceId: string;
        },
    ): Promise<void> {
        try {
            await Promise.all([
                this.storeKeyMaterial({
                    privateKeyJwk: identity.privateKeyJwk,
                    publicKeyJwk: identity.publicKeyJwk,
                    publicKeySpki: identity.publicKeySpki,
                }),
                idbSet(this.db, STORE_META, 'deviceId', identity.deviceId),
            ]);
        } catch (error) {
            throw new KeyStorageError('Failed to persist your derived device keys locally.', error);
        }
    }

    private async loadStoredKeyMaterial(): Promise<StoredKeyMaterial | null> {
        const [privateKeyJwk, publicKeyJwk, publicKeySpki] = await Promise.all([
            idbGet<JsonWebKey>(this.db, STORE_META, META_PRIVATE_JWK),
            idbGet<JsonWebKey>(this.db, STORE_META, META_PUBLIC_JWK),
            idbGet<string>(this.db, STORE_META, META_PUBLIC_SPKI),
        ]);

        if (!privateKeyJwk || !publicKeyJwk || !publicKeySpki) {
            return null;
        }

        return { privateKeyJwk, publicKeyJwk, publicKeySpki };
    }

    private async storeKeyMaterial(keyMaterial: StoredKeyMaterial): Promise<void> {
        await Promise.all([
            idbSet(this.db, STORE_META, META_PRIVATE_JWK, keyMaterial.privateKeyJwk),
            idbSet(this.db, STORE_META, META_PUBLIC_JWK, keyMaterial.publicKeyJwk),
            idbSet(this.db, STORE_META, META_PUBLIC_SPKI, keyMaterial.publicKeySpki),
            idbDelete(this.db, STORE_META, META_LEGACY_KEYPAIR),
        ]);
    }
}
