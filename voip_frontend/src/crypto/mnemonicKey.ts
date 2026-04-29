import { generateMnemonic as bip39Generate, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hkdfSha256 } from '@/crypto/hkdfSha256';
import { bufToBase64 } from '@/crypto/base64';
import { deriveP256JwkPair } from '@/crypto/p256';
import { DeviceIdentityDerivationError } from '@/crypto/errors';

interface DeviceIdentity {
    keyPair: CryptoKeyPair;
    privateKeyJwk: JsonWebKey;
    publicKeyJwk: JsonWebKey;
    publicKeySpki: string;
    deviceId: string;
}

function bytesToUuid(bytes: Uint8Array): string {
    const h = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function generateNewMnemonic(): string {
    return bip39Generate(wordlist, 256);
}

export function isMnemonicValid(mnemonic: string): boolean {
    return validateMnemonic(mnemonic.trim(), wordlist);
}

export async function deriveDeviceIdentity(mnemonic: string): Promise<DeviceIdentity> {
    const normalised = mnemonic.trim();
    if (!isMnemonicValid(normalised)) {
        throw new Error('Invalid mnemonic: check that all 24 words are correct and try again.');
    }

    let seedBuf: ArrayBuffer;
    try {
        const seed = await mnemonicToSeed(normalised);
        seedBuf = seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength) as ArrayBuffer;
    } catch (error) {
        throw new DeviceIdentityDerivationError('seed', error);
    }

    const [scalarBuf, uuidBuf] = await Promise.all([
        hkdfSha256(seedBuf, 'voip-ecdh-v1', 32),
        hkdfSha256(seedBuf, 'voip-device-id-v1', 16),
    ]);

    const deviceId = bytesToUuid(new Uint8Array(uuidBuf));
    const { privateJwk, publicJwk } = deriveP256JwkPair(new Uint8Array(scalarBuf));

    let publicKey: CryptoKey;
    let privateKey: CryptoKey;
    try {
        [publicKey, privateKey] = await Promise.all([
            crypto.subtle.importKey(
                'jwk',
                publicJwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                [],
            ),
            crypto.subtle.importKey(
                'jwk',
                privateJwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                ['deriveKey', 'deriveBits'],
            ),
        ]);
    } catch (error) {
        throw new DeviceIdentityDerivationError('key-import', error);
    }

    let spkiBuf: ArrayBuffer;
    try {
        spkiBuf = await crypto.subtle.exportKey('spki', publicKey);
    } catch (error) {
        throw new DeviceIdentityDerivationError('public-export', error);
    }

    return {
        keyPair: { privateKey, publicKey },
        privateKeyJwk: privateJwk,
        publicKeyJwk: publicJwk,
        publicKeySpki: bufToBase64(spkiBuf),
        deviceId,
    };
}
