/** Encode an ArrayBuffer to a base64 string. Loop-based to avoid stack overflow on large buffers. */
export function bufToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Encode a Uint8Array as base64url (no padding), as required by JWK. */
export function toBase64url(buf: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Decode a base64 string to an ArrayBuffer. */
export function base64ToBuf(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        arr[i] = bin.charCodeAt(i);
    }
    return arr.buffer;
}
