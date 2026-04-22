export class ChannelKeyNotFoundError extends Error {
    readonly channelId: string;
    readonly version: number;

    constructor(channelId: string, version: number) {
        super(`Channel key v${version} not found for channel "${channelId}"`);
        this.name = 'ChannelKeyNotFoundError';
        this.channelId = channelId;
        this.version = version;
    }
}

export class KeyDecryptionError extends Error {
    readonly channelId: string;
    readonly keyVersion: number;

    constructor(channelId: string, keyVersion: number, cause?: unknown) {
        super(`Failed to decrypt key bundle for channel "${channelId}" v${keyVersion}`);
        this.name = 'KeyDecryptionError';
        this.channelId = channelId;
        this.keyVersion = keyVersion;
        if (cause) this.cause = cause;
    }
}
