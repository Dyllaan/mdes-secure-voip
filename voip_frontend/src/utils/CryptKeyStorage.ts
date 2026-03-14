/**
 * Manages IndexedDB I/O and in-memory caching for channel epoch keys
 * and device identity material used by CryptKeyManager.
 */

import { bufToBase64 } from '@/crypto/base64';

const DB_NAME = 'channel-keys-v1';
const DB_VERSION = 2;
const STORE_META = 'meta';
const STORE_CHANNEL_KEYS = 'channelKeys';

function openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
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

export class CryptKeyStorage {
    private db: IDBDatabase;
    private keyCache = new Map<string, CryptoKey>();

    private constructor(db: IDBDatabase) {
        this.db = db;
    }

    static async open(): Promise<CryptKeyStorage> {
        return new CryptKeyStorage(await openIDB());
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
        let keyPair = await idbGet<CryptoKeyPair>(this.db, STORE_META, 'ecdhKeyPair');
        if (!keyPair) {
            keyPair = await crypto.subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                ['deriveKey', 'deriveBits'],
            );
            await idbSet(this.db, STORE_META, 'ecdhKeyPair', keyPair);
        }
        const spkiBuf = await crypto.subtle.exportKey('spki', keyPair.publicKey);
        return { keyPair, publicKeySpki: bufToBase64(spkiBuf) };
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
        const stored = await idbGet<CryptoKeyPair>(this.db, STORE_META, 'ecdhKeyPair');
        return stored !== undefined;
    }

    async initFromDerived(
        keyPair: CryptoKeyPair,
        publicKeySpki: string,
        deviceId: string,
    ): Promise<void> {
        await idbSet(this.db, STORE_META, 'ecdhKeyPair', keyPair);
        await idbSet(this.db, STORE_META, 'publicKeySpki', publicKeySpki);
        await idbSet(this.db, STORE_META, 'deviceId', deviceId);
    }
}
