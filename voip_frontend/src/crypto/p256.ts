import { p256 } from '@noble/curves/nist';
import { toBase64url } from '@/crypto/base64';

const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const BYTE_LENGTH = 32;
const UNCOMPRESSED_PUBLIC_KEY_LENGTH = 65;

function mod(value: bigint, modulus: bigint): bigint {
    const result = value % modulus;
    return result >= 0n ? result : result + modulus;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let current = value;

    for (let index = length - 1; index >= 0; index--) {
        bytes[index] = Number(current & 0xffn);
        current >>= 8n;
    }

    return bytes;
}

export interface P256KeyMaterial {
    privateJwk: JsonWebKey;
    publicJwk: JsonWebKey;
}

export function normaliseP256PrivateScalar(rawScalar: Uint8Array): Uint8Array {
    const value = bytesToBigInt(rawScalar);
    const normalised = mod(value, N - 1n) + 1n;
    return bigIntToBytes(normalised, BYTE_LENGTH);
}

export function deriveP256JwkPair(privateScalar: Uint8Array): P256KeyMaterial {
    const normalisedScalar = normaliseP256PrivateScalar(privateScalar);
    const publicKey = p256.getPublicKey(normalisedScalar, false);

    if (publicKey.length !== UNCOMPRESSED_PUBLIC_KEY_LENGTH || publicKey[0] !== 0x04) {
        throw new Error('Failed to derive P-256 public point');
    }

    const x = publicKey.slice(1, 33);
    const y = publicKey.slice(33, 65);

    return {
        privateJwk: {
            kty: 'EC',
            crv: 'P-256',
            d: toBase64url(normalisedScalar),
            x: toBase64url(x),
            y: toBase64url(y),
            ext: true,
        },
        publicJwk: {
            kty: 'EC',
            crv: 'P-256',
            x: toBase64url(x),
            y: toBase64url(y),
            ext: true,
        },
    };
}
