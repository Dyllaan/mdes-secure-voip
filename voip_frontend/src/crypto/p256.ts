import { toBase64url } from '@/crypto/base64';

const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const A = P - 3n;
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const GX = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
const GY = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');
const BYTE_LENGTH = 32;

type AffinePoint = { x: bigint; y: bigint } | null;

function mod(value: bigint, modulus: bigint): bigint {
    const result = value % modulus;
    return result >= 0n ? result : result + modulus;
}

function invert(value: bigint, modulus: bigint): bigint {
    let t = 0n;
    let newT = 1n;
    let r = modulus;
    let newR = mod(value, modulus);

    while (newR !== 0n) {
        const quotient = r / newR;
        [t, newT] = [newT, t - quotient * newT];
        [r, newR] = [newR, r - quotient * newR];
    }

    if (r !== 1n) {
        throw new Error('Value has no modular inverse');
    }

    return mod(t, modulus);
}

function pointDouble(point: AffinePoint): AffinePoint {
    if (!point) return null;
    if (point.y === 0n) return null;

    const slope = mod((3n * point.x * point.x + A) * invert(2n * point.y, P), P);
    const x = mod(slope * slope - 2n * point.x, P);
    const y = mod(slope * (point.x - x) - point.y, P);

    return { x, y };
}

function pointAdd(left: AffinePoint, right: AffinePoint): AffinePoint {
    if (!left) return right;
    if (!right) return left;

    if (left.x === right.x) {
        if (mod(left.y + right.y, P) === 0n) {
            return null;
        }
        return pointDouble(left);
    }

    const slope = mod((right.y - left.y) * invert(right.x - left.x, P), P);
    const x = mod(slope * slope - left.x - right.x, P);
    const y = mod(slope * (left.x - x) - left.y, P);

    return { x, y };
}

function scalarMultiply(scalar: bigint): AffinePoint {
    let result: AffinePoint = null;
    let addend: AffinePoint = { x: GX, y: GY };
    let k = scalar;

    while (k > 0n) {
        if ((k & 1n) === 1n) {
            result = pointAdd(result, addend);
        }
        addend = pointDouble(addend);
        k >>= 1n;
    }

    return result;
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
    const scalar = bytesToBigInt(normalisedScalar);
    const publicPoint = scalarMultiply(scalar);

    if (!publicPoint) {
        throw new Error('Failed to derive P-256 public point');
    }

    return {
        privateJwk: {
            kty: 'EC',
            crv: 'P-256',
            d: toBase64url(normalisedScalar),
            x: toBase64url(bigIntToBytes(publicPoint.x, BYTE_LENGTH)),
            y: toBase64url(bigIntToBytes(publicPoint.y, BYTE_LENGTH)),
            ext: true,
        },
        publicJwk: {
            kty: 'EC',
            crv: 'P-256',
            x: toBase64url(bigIntToBytes(publicPoint.x, BYTE_LENGTH)),
            y: toBase64url(bigIntToBytes(publicPoint.y, BYTE_LENGTH)),
            ext: true,
        },
    };
}
