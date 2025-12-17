import { SignalProtocolAddressType, StorageType, KeyPairType } from './types';
import { DeviceType, SessionType } from './session-types';
import { SessionRecord } from './session-record';
import { PreKeyWhisperMessage } from '@privacyresearch/libsignal-protocol-protobuf-ts';
export declare class SessionBuilder {
    remoteAddress: SignalProtocolAddressType;
    storage: StorageType;
    constructor(storage: StorageType, remoteAddress: SignalProtocolAddressType);
    processPreKeyJob: (device: DeviceType) => Promise<SessionType>;
    startSessionAsInitiator: (EKa: KeyPairType<ArrayBuffer>, IKb: ArrayBuffer, SPKb: ArrayBuffer, OPKb: ArrayBuffer | undefined, registrationId?: number | undefined) => Promise<SessionType>;
    startSessionWthPreKeyMessage: (OPKb: KeyPairType<ArrayBuffer> | undefined, SPKb: KeyPairType<ArrayBuffer>, message: PreKeyWhisperMessage) => Promise<SessionType>;
    calculateSendingRatchet(session: SessionType, remoteKey: ArrayBuffer): Promise<void>;
    processPreKey(device: DeviceType): Promise<SessionType>;
    processV3(record: SessionRecord, message: PreKeyWhisperMessage): Promise<number | void>;
}
