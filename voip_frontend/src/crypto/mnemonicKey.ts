import { generateMnemonic as bip39Generate, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hkdfSha256 } from '@/crypto/hkdfSha256';
import { bufToBase64 } from '@/crypto/base64';

interface DeviceIdentity {
    keyPair: CryptoKeyPair;
    publicKeySpki: string;
    deviceId: string;
}

// Minimal PKCS8 wrapper for a P-256 scalar - lets WebCrypto compute (x,y) for us
function scalarToPkcs8(scalar: Uint8Array): ArrayBuffer {
    const header = new Uint8Array([
        0x30, 0x41,
        0x02, 0x01, 0x00,
        0x30, 0x13,
          0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
          0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
        0x04, 0x27,
          0x30, 0x25,
            0x02, 0x01, 0x01,
            0x04, 0x20,
    ]);
    const buf = new Uint8Array(header.length + scalar.length);
    buf.set(header);
    buf.set(scalar, header.length);
    return buf.buffer;
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

    const deviceId = bytesToUuid(new Uint8Array(uuidBuf));

    const extractablePrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        scalarToPkcs8(new Uint8Array(scalarBuf)),
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits'],
    );

    const jwk = await crypto.subtle.exportKey('jwk', extractablePrivateKey);

    const [publicKey, privateKey] = await Promise.all([
        crypto.subtle.importKey(
            'jwk',
            { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [],
        ),
        crypto.subtle.importKey(
            'jwk',
            jwk,
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