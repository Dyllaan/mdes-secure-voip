import * as Internal from './internal';
import { KeyPairType, AsyncCurveType } from './types';
export declare class Curve {
    private _curve;
    async: AsyncCurve;
    constructor(curve: Internal.Curve);
    generateKeyPair(): KeyPairType;
    createKeyPair(privKey: ArrayBuffer): KeyPairType;
    calculateAgreement(pubKey: ArrayBuffer, privKey: ArrayBuffer): ArrayBuffer;
    verifySignature(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): boolean;
    calculateSignature(privKey: ArrayBuffer, message: ArrayBuffer): ArrayBuffer;
}
export declare class AsyncCurve implements AsyncCurveType {
    private _curve;
    constructor(curve: Internal.AsyncCurve);
    generateKeyPair(): Promise<KeyPairType>;
    createKeyPair(privKey: ArrayBuffer): Promise<KeyPairType>;
    calculateAgreement(pubKey: ArrayBuffer, privKey: ArrayBuffer): Promise<ArrayBuffer>;
    verifySignature(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): Promise<boolean>;
    calculateSignature(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer>;
}
