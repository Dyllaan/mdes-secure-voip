import * as Internal from '.';
import { KeyPairType } from '../types';
import { AsyncCurve as AsyncCurveType } from '@privacyresearch/curve25519-typescript';
export declare class Crypto {
    private _curve;
    private _webcrypto;
    constructor(crypto?: globalThis.Crypto);
    set webcrypto(wc: globalThis.Crypto);
    set curve(c: AsyncCurveType);
    getRandomBytes(n: number): ArrayBuffer;
    encrypt(key: ArrayBuffer, data: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer>;
    decrypt(key: ArrayBuffer, data: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer>;
    sign(key: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer>;
    hash(data: ArrayBuffer): Promise<ArrayBuffer>;
    HKDF(input: ArrayBuffer, salt: ArrayBuffer, info: ArrayBuffer): Promise<ArrayBuffer[]>;
    createKeyPair(privKey?: ArrayBuffer): Promise<KeyPairType>;
    ECDHE(pubKey: ArrayBuffer, privKey: ArrayBuffer): Promise<ArrayBuffer>;
    Ed25519Sign(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer>;
    Ed25519Verify(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): Promise<boolean>;
}
export declare const crypto: Internal.Crypto;
export declare function setWebCrypto(webcrypto: globalThis.Crypto): void;
export declare function setCurve(curve: AsyncCurveType): void;
export declare function HKDF(input: ArrayBuffer, salt: ArrayBuffer, info: string): Promise<ArrayBuffer[]>;
export declare function verifyMAC(data: ArrayBuffer, key: ArrayBuffer, mac: ArrayBuffer, length: number): Promise<void>;
export declare function calculateMAC(key: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer>;
