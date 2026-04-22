/** HKDF-SHA256 key derivation. Used by mnemonicKey.ts to derive sub-keys from a BIP-39 seed. */
export async function hkdfSha256(
    keyMaterial: ArrayBuffer,
    info: string,
    lengthBytes: number,
): Promise<ArrayBuffer> {
    const baseKey = await crypto.subtle.importKey(
        'raw', keyMaterial, { name: 'HKDF' }, false, ['deriveBits'],
    );

    return crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(32),
            info: new TextEncoder().encode(info),
        },
        baseKey,
        lengthBytes * 8,
    );
}
