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

export class DeviceIdentityDerivationError extends Error {
    readonly step: 'seed' | 'key-import' | 'public-export';

    constructor(step: DeviceIdentityDerivationError['step'], cause?: unknown) {
        const messageByStep: Record<DeviceIdentityDerivationError['step'], string> = {
            seed: 'Failed to derive a device seed from the recovery phrase.',
            'key-import': 'Failed to import the recovery phrase as a portable P-256 keypair.',
            'public-export': 'Failed to export the derived public key.',
        };

        super(messageByStep[step]);
        this.name = 'DeviceIdentityDerivationError';
        this.step = step;
        if (cause) this.cause = cause;
    }
}

export class KeyStorageError extends Error {
    readonly operation: string;

    constructor(operation: string, cause?: unknown) {
        super(operation);
        this.name = 'KeyStorageError';
        this.operation = operation;
        if (cause) this.cause = cause;
    }
}
