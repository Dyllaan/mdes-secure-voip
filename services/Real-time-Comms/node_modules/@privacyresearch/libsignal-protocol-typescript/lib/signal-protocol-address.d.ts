import { SignalProtocolAddressType } from './';
export declare class SignalProtocolAddress implements SignalProtocolAddressType {
    static fromString(s: string): SignalProtocolAddress;
    private _name;
    private _deviceId;
    constructor(_name: string, _deviceId: number);
    get name(): string;
    get deviceId(): number;
    getName(): string;
    getDeviceId(): number;
    toString(): string;
    equals(other: SignalProtocolAddressType): boolean;
}
