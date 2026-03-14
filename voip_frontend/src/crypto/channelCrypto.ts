/**
 * Pure WebCrypto primitives for channel message encryption and ECIES key distribution.
 * AES-256-GCM for messages, P-256 ECDH + HKDF-SHA256 + AES-256-GCM for key wrapping.
 */

import { bufToBase64, base64ToBuf } from '@/crypto/base64';
import type { ChannelKeyBundle } from '@/types/server.types';

export const HKDF_INFO = new TextEncoder().encode('channel-key-wrap');
export const HKDF_SALT = new Uint8Array(32);

/** Build AAD bytes: `"{channelId}:{version}:{senderId}"` for AES-GCM binding. */
export function buildAAD(channelId: string, version: number, senderId: string): Uint8Array {
    return new TextEncoder().encode(`${channelId}:${version}:${senderId}`);
}

/** Generate a fresh extractable AES-256-GCM key for channel messages. */
export async function generateAesKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );
}

/** HKDF-SHA256: derive a 256-bit AES-GCM wrapping key from ECDH shared bits. */
export async function hkdfDerive(sharedBits: ArrayBuffer): Promise<CryptoKey> {
    const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);

    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/** ECIES wrap: encrypt rawKeyMaterial for a recipient's SPKI base64 P-256 public key. */
export async function eciesWrap(
    rawKeyMaterial: ArrayBuffer,
    recipientSpkiBase64: string,
): Promise<{ senderEphemeralPub: string; ciphertext: string; iv: string }> {
    const recipientPubKey = await crypto.subtle.importKey(
        'spki', base64ToBuf(recipientSpkiBase64),
        { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );

    const ephemeralPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    );

    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipientPubKey }, ephemeralPair.privateKey, 256,
    );

    const wrapKey = await hkdfDerive(sharedBits);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: wrapIv }, wrapKey, rawKeyMaterial,
    );

    const ephemeralSpkiBuf = await crypto.subtle.exportKey('spki', ephemeralPair.publicKey);

    return {
        senderEphemeralPub: bufToBase64(ephemeralSpkiBuf),
        ciphertext: bufToBase64(ciphertextBuf),
        iv: bufToBase64(wrapIv.buffer),
    };
}

/** ECIES unwrap: decrypt a key bundle using the recipient's private key. */
export async function eciesUnwrap(
    bundle: Pick<ChannelKeyBundle, 'senderEphemeralPub' | 'ciphertext' | 'iv'>,
    privateKey: CryptoKey,
): Promise<CryptoKey> {
    const ephemeralPubKey = await crypto.subtle.importKey(
        'spki', base64ToBuf(bundle.senderEphemeralPub),
        { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );

    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: ephemeralPubKey }, privateKey, 256,
    );

    const wrapKey = await hkdfDerive(sharedBits);
    const iv = new Uint8Array(base64ToBuf(bundle.iv));

    const rawKeyMaterial = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, wrapKey, base64ToBuf(bundle.ciphertext),
    );

    return crypto.subtle.importKey(
        'raw', rawKeyMaterial, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'],
    );
}
