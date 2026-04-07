export type ChannelType = 'text' | 'voice';

export interface Hub {
    id: string;
    name: string;
    ownerId: string;
    createdAt: string;
}

export interface Channel {
    id: string;
    name: string;
    hubId: string;
    type: ChannelType;
    createdAt: string;
}

export interface Member {
    id: string;
    userId: string;
    hubId: string;
    role: 'owner' | 'admin' | 'member' | 'bot';
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

/** P-256 ECDH public key registered by a member's device for this hub. */
export interface MemberDeviceKey {
    id: string;
    userId: string;
    deviceId: string;
    hubId: string;
    /** P-256 SPKI public key, base64url-encoded */
    publicKey: string;
    updatedAt: string;
}

/** ECIES-encrypted channel symmetric key bundle addressed to one recipient device. */
export interface ChannelKeyBundle {
    id: string;
    channelId: string;
    hubId: string;
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