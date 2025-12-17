import { FingerprintGeneratorType } from './';
export declare class FingerprintGenerator implements FingerprintGeneratorType {
    static VERSION: number;
    createFor(localIdentifier: string, localIdentityKey: ArrayBuffer, remoteIdentifier: string, remoteIdentityKey: ArrayBuffer): Promise<string>;
    private _iterations;
    constructor(_iterations: number);
}
