import { createLogger } from '../logging';

function captureStdout() {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(chunk.toString());
        return true;
    }) as typeof process.stdout.write);

    return {
        spy,
        entries: () => writes
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
}

describe('logging', () => {
    afterEach(() => {
        delete process.env.DEBUG;
        jest.restoreAllMocks();
    });

    it('redacts secret fields and websocket token query params', () => {
        const output = captureStdout();
        const logger = createLogger('test.logging');

        logger.info('logging.redaction', {
            botSecret: 'bot-secret-value',
            password: 'turn-pass',
            token: 'auth-token',
            authorization: 'Bearer my-token',
            wsUrl: 'wss://peer.test/peerjs?token=raw-token&foo=bar',
        });

        const entry = output.entries()[0];
        expect(entry).toMatchObject({
            context: 'test.logging',
            botSecret: '[REDACTED len=16]',
            password: '[REDACTED len=9]',
            token: '[REDACTED len=10]',
            authorization: '[REDACTED len=15]',
            wsUrl: expect.stringContaining('token=%5BREDACTED'),
        });

        output.spy.mockRestore();
    });

    it('only emits debug logs when DEBUG is enabled', () => {
        const output = captureStdout();
        const logger = createLogger('test.logging');

        delete process.env.DEBUG;
        logger.debug('debug.disabled');
        expect(output.entries()).toHaveLength(0);

        process.env.DEBUG = 'true';
        logger.debug('debug.enabled', { step: 'verification' });
        expect(output.entries()).toContainEqual(expect.objectContaining({
            context: 'test.logging',
            message: 'debug.enabled',
            step: 'verification',
        }));

        output.spy.mockRestore();
    });
});
