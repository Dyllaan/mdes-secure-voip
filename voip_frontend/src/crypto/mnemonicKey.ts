/**
 * Derives a stable device identity (P-256 ECDH keypair + UUID) from a BIP-39 mnemonic.
 *
 * Derivation: mnemonic → BIP-39 seed → HKDF-SHA256 → P-256 scalar + device UUID.
 * Uses @noble/curves/p256 to compute public point (x,y) from the scalar because
 * Chrome's WebCrypto importKey('jwk') requires all JWK fields for ECDH.
 */

import { generateMnemonic as bip39Generate, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { p256 } from '@noble/curves/nist.js';
import { hkdfSha256 } from '@/crypto/hkdfSha256';
import { bufToBase64, toBase64url } from '@/crypto/base64';

interface DeviceIdentity {
    keyPair: CryptoKeyPair;
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

    const seed = await mnemonicToSeed(normalised);
    const seedBuf = seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength) as ArrayBuffer;

    const [scalarBuf, uuidBuf] = await Promise.all([
        hkdfSha256(seedBuf, 'voip-ecdh-v1', 32),
        hkdfSha256(seedBuf, 'voip-device-id-v1', 16),
    ]);

    const scalar = new Uint8Array(scalarBuf);
    const deviceId = bytesToUuid(new Uint8Array(uuidBuf));

    // Compute (x, y) = scalar·G on P-256 (65-byte uncompressed point: 0x04 ‖ x ‖ y)
    const pubPoint = p256.getPublicKey(scalar, false);
    const xBytes = pubPoint.slice(1, 33);
    const yBytes = pubPoint.slice(33, 65);

    const fullJwk: JsonWebKey = {
        kty: 'EC',
        crv: 'P-256',
        d: toBase64url(scalar),
        x: toBase64url(xBytes),
        y: toBase64url(yBytes),
    };

    const [publicKey, privateKey] = await Promise.all([
        crypto.subtle.importKey(
            'jwk',
            { kty: 'EC', crv: 'P-256', x: fullJwk.x, y: fullJwk.y },
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [],
        ),
        crypto.subtle.importKey(
            'jwk',
            fullJwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            ['deriveKey', 'deriveBits'],
        ),
    ]);

    const spkiBuf = await crypto.subtle.exportKey('spki', publicKey);

    return {
        keyPair: { privateKey, publicKey },
        publicKeySpki: bufToBase64(spkiBuf),
        deviceId,
    };
}
