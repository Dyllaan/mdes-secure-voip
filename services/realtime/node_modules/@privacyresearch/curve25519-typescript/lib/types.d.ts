export interface KeyPair {
    pubKey: ArrayBuffer;
    privKey: ArrayBuffer;
}
export interface Curve {
    keyPair(privKey: ArrayBuffer): KeyPair;
    sharedSecret(pubKey: ArrayBuffer, privKey: ArrayBuffer): ArrayBuffer;
    sign(privKey: ArrayBuffer, message: ArrayBuffer): ArrayBuffer;
    verify(pubKey: ArrayBuffer, message: ArrayBuffer, sig: ArrayBuffer): boolean;
}
export interface AsyncCurve {
    keyPair(privKey: ArrayBuffer): Promise<KeyPair>;
    sharedSecret(pubKey: ArrayBuffer, privKey: ArrayBuffer): Promise<ArrayBuffer>;
    sign(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer>;
    verify(pubKey: ArrayBuffer, message: ArrayBuffer, sig: ArrayBuffer): Promise<boolean>;
}
