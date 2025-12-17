import { KeyPairType } from '../types';
import { Curve25519Wrapper, AsyncCurve as AsyncCurveType, Curve as CurveType } from '@privacyresearch/curve25519-typescript';
export declare class Curve {
    private _curve25519;
    async: AsyncCurve;
    constructor(curve25519: Curve25519Wrapper);
    set curve(c: CurveType);
    createKeyPair(privKey: ArrayBuffer): KeyPairType;
    ECDHE(pubKey: ArrayBuffer, privKey: ArrayBuffer): ArrayBuffer;
    Ed25519Sign(privKey: ArrayBuffer, message: ArrayBuffer): ArrayBuffer;
    Ed25519Verify(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): boolean;
}
export declare class AsyncCurve {
    private _curve25519;
    constructor();
    set curve(c: AsyncCurveType);
    createKeyPair(privKey: ArrayBuffer): Promise<KeyPairType>;
    ECDHE(pubKey: ArrayBuffer, privKey: ArrayBuffer): Promise<ArrayBuffer>;
    Ed25519Sign(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer>;
    Ed25519Verify(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): Promise<boolean>;
}
