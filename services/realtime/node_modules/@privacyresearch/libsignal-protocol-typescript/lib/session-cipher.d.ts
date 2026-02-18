import { StorageType } from './types';
import { SessionType } from './session-types';
import { SignalProtocolAddress } from './signal-protocol-address';
import { SessionRecord } from './session-record';
export interface MessageType {
    type: number;
    body?: string;
    registrationId?: number;
}
export declare class SessionCipher {
    storage: StorageType;
    remoteAddress: SignalProtocolAddress;
    constructor(storage: StorageType, remoteAddress: SignalProtocolAddress | string);
    getRecord(encodedNumber: string): Promise<SessionRecord | undefined>;
    encrypt(buffer: ArrayBuffer): Promise<MessageType>;
    private encryptJob;
    private loadKeysAndRecord;
    private prepareChain;
    private fillMessageKeys;
    private calculateRatchet;
    decryptPreKeyWhisperMessage(buff: string | ArrayBuffer, encoding?: string): Promise<ArrayBuffer>;
    decryptWithSessionList(buffer: ArrayBuffer, sessionList: SessionType[], errors: any[]): Promise<{
        plaintext: ArrayBuffer;
        session: SessionType;
    }>;
    decryptWhisperMessage(buff: string | ArrayBuffer, encoding?: string): Promise<ArrayBuffer>;
    doDecryptWhisperMessage(messageBytes: ArrayBuffer, session: SessionType): Promise<ArrayBuffer>;
    maybeStepRatchet(session: SessionType, remoteKey: ArrayBuffer, previousCounter: number): Promise<void>;
    getRemoteRegistrationId(): Promise<number | undefined>;
    hasOpenSession(): Promise<boolean>;
    closeOpenSessionForDevice(): Promise<void>;
    deleteAllSessionsForDevice(): Promise<void>;
}
