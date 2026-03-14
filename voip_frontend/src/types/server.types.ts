export type ChannelType = 'text' | 'voice';

export interface Server {
    id: string;
    name: string;
    ownerId: string;
    createdAt: string;
}

export interface Channel {
    id: string;
    name: string;
    serverId: string;
    type: ChannelType;
    createdAt: string;
}

export interface Member {
    id: string;
    userId: string;
    serverId: string;
    role: 'owner' | 'admin' | 'member';
    joinedAt: string;
}

export interface EncryptedMessage {
    id: string;
    channelId: string;
    senderId: string;
    ciphertext: string;
    iv: string;
    keyVersion: string;
    timestamp: string;
}

export interface MessageHistoryResponse {
    messages: EncryptedMessage[];
    hasMore: boolean;
}

/** P-256 ECDH public key registered by a member's device for this server. */
export interface MemberDeviceKey {
    id: string;
    userId: string;
    deviceId: string;
    serverId: string;
    /** P-256 SPKI public key, base64url-encoded */
    publicKey: string;
    updatedAt: string;
}

/** ECIES-encrypted channel symmetric key bundle addressed to one recipient device. */
export interface ChannelKeyBundle {
    id: string;
    channelId: string;
    serverId: string;
    recipientUserId: string;
    recipientDeviceId: string;
    keyVersion: number;
    /** Ephemeral P-256 sender public key (SPKI, base64url) used for ECDH */
    senderEphemeralPub: string;
    /** AES-GCM ciphertext of the 32-byte channel key, base64url */
    ciphertext: string;
    /** 12-byte IV for the AES-GCM wrap, base64url */
    iv: string;
    distributorId: string;
    createdAt: string;
}

/** Payload sent to POST /channel-keys/bundles */
export interface PostKeyBundlesPayload {
    channelId: string;
    keyVersion: number;
    bundles: Array<{
        recipientUserId: string;
        recipientDeviceId: string;
        senderEphemeralPub: string;
        ciphertext: string;
        iv: string;
    }>;
}

export interface EphemeralMessage {
    sender: string;
    message: string;
    alias: string;
    timestamp?: string;
}

/** Channel key rotation flag */
export interface ChannelRotationFlag {
    channelId: string;
    rotationNeeded: boolean;
    rotationNeededSince?: string;
    removedUserId?: string;
}