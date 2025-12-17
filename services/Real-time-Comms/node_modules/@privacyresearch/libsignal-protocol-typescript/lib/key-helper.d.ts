import { KeyPairType, SignedPreKeyPairType, PreKeyPairType } from './types';
export declare class KeyHelper {
    static generateIdentityKeyPair(): Promise<KeyPairType>;
    static generateRegistrationId(): number;
    static generateSignedPreKey(identityKeyPair: KeyPairType, signedKeyId: number): Promise<SignedPreKeyPairType>;
    static generatePreKey(keyId: number): Promise<PreKeyPairType>;
}
