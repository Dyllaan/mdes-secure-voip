import jwt from 'jsonwebtoken';
import SocketEventHandlers from '../../handlers/SocketEventHandlers';
import config from '../../config';

jest.mock('jsonwebtoken');
jest.mock('../../room/RoomManager', () =>
    jest.fn().mockImplementation(() => ({
        rooms: new Map(),
        createRoom: jest.fn(),
        joinRoom: jest.fn().mockResolvedValue(true),
        leaveRoom: jest.fn(),
        updateUserAlias: jest.fn(),
        removeUser: jest.fn(),
        deleteRoom: jest.fn(),
        forceLeaveRoom: jest.fn(),
        checkHubMembership: jest.fn().mockResolvedValue(true),
        checkChannelAccess: jest.fn().mockResolvedValue(true),
    }))
);

const cfg = config.services.realtime;
const lim = cfg.security;
const mockedJwt = jwt as jest.Mocked<typeof jwt>;

function makeIo() {
    const broadcast = { emit: jest.fn() };
    const middlewares: Array<(socket: any, next: Function) => void> = [];
    const connHandlers: Array<(socket: any) => void> = [];

    return {
        use: jest.fn((fn: any) => middlewares.push(fn)),
        on: jest.fn((event: string, fn: any) => {
            if (event === 'connection') connHandlers.push(fn);
        }),
        to: jest.fn().mockReturnValue(broadcast),
        sockets: { sockets: new Map<string, any>() },
        _middlewares: middlewares,
        _connHandlers: connHandlers,
        _broadcast: broadcast,
    };
}

function makeHandler() {
    const io = makeIo();
    const handler = new SocketEventHandlers({ config: cfg, io } as any);
    const roomManager = (handler as any).roomManager;
    handler.setup();
    return { handler, io, roomManager };
}

function connectSocket(
    io: ReturnType<typeof makeIo>,
    overrides: {
        id?: string;
        userId?: string;
        username?: string;
        peerId?: string;
        roomId?: string;
        rooms?: Set<string>;
    } = {}
) {
    const id = overrides.id ?? 'socket-001';
    const eventHandlers: Record<string, Function[]> = {};
    const toReturn = { emit: jest.fn() };

    const socket = {
        id,
        userId: overrides.userId ?? 'user-001',
        username: overrides.username ?? 'testuser',
        token: 'mock-token',
        peerId: overrides.peerId ?? 'peer-001',
        roomId: overrides.roomId,
        rooms: overrides.rooms ?? new Set<string>([id]),
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnValue(toReturn),
        disconnect: jest.fn(),
        on: jest.fn((event: string, fn: Function) => {
            if (!eventHandlers[event]) eventHandlers[event] = [];
            eventHandlers[event].push(fn);
        }),
        _toReturn: toReturn,
    };

    io.sockets.sockets.set(id, socket);
    io._connHandlers[0]?.(socket);

    const trigger = (event: string, data?: any) =>
        eventHandlers[event]?.forEach(fn => fn(data));

    return { socket, trigger };
}

describe('SocketEventHandlers', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.useFakeTimers();
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockedJwt.verify.mockReturnValue({ sub: 'user-001', token_use: 'access' } as any);
    });

    afterEach(() => {
        jest.useRealTimers();
        errorSpy.mockRestore();
        jest.clearAllMocks();
    });

    describe('middleware', () => {
        it('rejects connection with no token', () => {
            const { io } = makeHandler();
            const next = jest.fn();
            io._middlewares[0]({ handshake: { auth: {} } }, next);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Authentication required' })
            );
        });

        it('rejects connection with an invalid token', () => {
            const { io } = makeHandler();
            mockedJwt.verify.mockImplementation(() => { throw new Error('bad'); });
            const next = jest.fn();
            io._middlewares[0]({ handshake: { auth: { token: 'bad', username: 'alice' } } }, next);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid or expired token' })
            );
        });

        it('rejects connection when a refresh token is presented', () => {
            const { io } = makeHandler();
            mockedJwt.verify.mockReturnValue({ sub: 'user-001', token_use: 'refresh' } as any);
            const next = jest.fn();
            io._middlewares[0]({ handshake: { auth: { token: 'bad', username: 'alice' } } }, next);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid or expired token' })
            );
        });

        it('rejects connection with a missing username', () => {
            const { io } = makeHandler();
            const next = jest.fn();
            io._middlewares[0]({ handshake: { auth: { token: 'valid' } } }, next);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid username' })
            );
        });

        it('rejects connection with an empty username', () => {
            const { io } = makeHandler();
            const next = jest.fn();
            io._middlewares[0]({ handshake: { auth: { token: 'valid', username: '' } } }, next);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid username' })
            );
        });

        it('rejects connection with a username exceeding maxUsernameLength', () => {
            const { io } = makeHandler();
            const next = jest.fn();
            io._middlewares[0]({
                handshake: { auth: { token: 'valid', username: 'a'.repeat(lim.maxUsernameLength + 1) } },
            }, next);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid username' })
            );
        });

        it('accepts valid credentials and sets userId, username, and token on the socket', () => {
            const { io } = makeHandler();
            const next = jest.fn();
            const socket: any = { handshake: { auth: { token: 'tok', username: 'alice' } } };
            io._middlewares[0](socket, next);
            expect(next).toHaveBeenCalledWith();
            expect(socket.userId).toBe('user-001');
            expect(socket.username).toBe('alice');
            expect(socket.token).toBe('tok');
        });
    });

    describe('connection setup', () => {
        it('creates a rate limit bucket keyed by userId on connection', () => {
            const { handler, io } = makeHandler();
            connectSocket(io);
            expect((handler as any).socketRateLimits.has('user-001')).toBe(true);
        });

        it('emits peer-assigned with a UUID', () => {
            const { io } = makeHandler();
            const { socket } = connectSocket(io);
            expect(socket.emit).toHaveBeenCalledWith('peer-assigned', {
                peerId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
            });
        });

        it('emits room-list on connection', () => {
            const { io } = makeHandler();
            const { socket } = connectSocket(io);
            expect(socket.emit).toHaveBeenCalledWith('room-list', { rooms: expect.any(Array) });
        });

        it('shares one rate limit bucket across multiple tabs for the same userId', () => {
            const { handler, io } = makeHandler();
            connectSocket(io, { id: 'socket-001', userId: 'user-multi' });
            connectSocket(io, { id: 'socket-002', userId: 'user-multi' });
            const buckets = (handler as any).socketRateLimits;
            const userBuckets = Array.from(buckets.keys() as IterableIterator<string>).filter(
                (k) => k === 'user-multi'
            );
            expect(userBuckets).toHaveLength(1);
        });
    });

    describe('channel-message-sent', () => {
        it('tamper-logs and blocks content exceeding maxChannelMessageLength', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-message-sent', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                content: 'x'.repeat(lim.maxChannelMessageLength + 1),
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('channel-message-sent'));
        });

        it('blocks oversized content without forwarding', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-message-sent', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                content: 'x'.repeat(lim.maxChannelMessageLength + 1),
            });
            expect(socket._toReturn.emit).not.toHaveBeenCalled();
        });

        it('forwards only whitelisted fields for a valid message', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-message-sent', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                content: 'hello',
                malicious: 'should be stripped',
            });
            expect(socket._toReturn.emit).toHaveBeenCalledWith('channel-message-sent', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                content: 'hello',
            });
        });

        it('silently drops without tamper log when socket is not in the hub room', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io);
            trigger('channel-message-sent', { hubId: 'hub-1', channelId: 'chan-1', content: 'hello' });
            expect(socket.to).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        });
    });

    describe('channel-created', () => {
        it('tamper-logs when socket is not in the hub', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('channel-created', { hubId: 'hub-1', channelId: 'chan-1', name: 'General' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('channel-created'));
        });

        it('tamper-logs when channel name exceeds maxChannelNameLength', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-created', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                name: 'x'.repeat(lim.maxChannelNameLength + 1),
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('forwards only whitelisted fields for a valid event', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-created', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                name: 'General',
                extra: 'stripped',
            });
            expect(socket._toReturn.emit).toHaveBeenCalledWith('channel-created', {
                hubId: 'hub-1',
                channelId: 'chan-1',
                name: 'General',
            });
        });
    });

    describe('channel-deleted', () => {
        it('tamper-logs when socket is not in the hub', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('channel-deleted', { hubId: 'hub-1', channelId: 'chan-1' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('channel-deleted'));
        });

        it('forwards only whitelisted fields for a valid event', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-deleted', { hubId: 'hub-1', channelId: 'chan-1', extra: 'stripped' });
            expect(socket._toReturn.emit).toHaveBeenCalledWith('channel-deleted', {
                hubId: 'hub-1',
                channelId: 'chan-1',
            });
        });
    });

    describe('member-joined', () => {
        it('tamper-logs when socket is not in the hub', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('member-joined', { hubId: 'hub-1', userId: 'user-new' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('member-joined'));
        });

        it('forwards only whitelisted fields for a valid event', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('member-joined', { hubId: 'hub-1', userId: 'user-new', extra: 'stripped' });
            expect(socket._toReturn.emit).toHaveBeenCalledWith('member-joined', {
                hubId: 'hub-1',
                userId: 'user-new',
            });
        });
    });

    describe('channel-key-rotated', () => {
        it('tamper-logs when socket is not in the hub', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('channel-key-rotated', { hubId: 'hub-1', channelId: 'chan-1' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('channel-key-rotated'));
        });

        it('forwards only whitelisted fields for a valid event', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { rooms: new Set(['s', 'hub:hub-1']) });
            trigger('channel-key-rotated', { hubId: 'hub-1', channelId: 'chan-1', extra: 'stripped' });
            expect(socket._toReturn.emit).toHaveBeenCalledWith('channel-key-rotated', {
                hubId: 'hub-1',
                channelId: 'chan-1',
            });
        });
    });

    describe('musicman:track-changed', () => {
        it('tamper-logs when socket is not in the room', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('musicman:track-changed', { roomId: 'room-1', title: 'Song', url: 'http://x.com' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('musicman:track-changed'));
        });

        it('tamper-logs when title exceeds maxMusicmanTitle', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('musicman:track-changed', {
                roomId: 'room-1',
                title: 'x'.repeat(lim.maxMusicmanTitle + 1),
                url: 'http://x.com',
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('tamper-logs when url exceeds maxMusicmanUrl', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('musicman:track-changed', {
                roomId: 'room-1',
                title: 'Song',
                url: 'x'.repeat(lim.maxMusicmanUrl + 1),
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('broadcasts whitelisted fields to the room for a valid event', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('musicman:track-changed', {
                roomId: 'room-1',
                title: 'Song',
                url: 'http://x.com',
                extra: 'stripped',
            });
            expect(io.to).toHaveBeenCalledWith('room-1');
            expect(io._broadcast.emit).toHaveBeenCalledWith('musicman:track-changed', {
                roomId: 'room-1',
                title: 'Song',
                url: 'http://x.com',
            });
        });
    });

    describe('musicman:track-ended', () => {
        it('tamper-logs when socket is not in the room', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('musicman:track-ended', { roomId: 'room-1' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('musicman:track-ended'));
        });

        it('broadcasts only roomId to the room for a valid event', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('musicman:track-ended', { roomId: 'room-1', extra: 'stripped' });
            expect(io.to).toHaveBeenCalledWith('room-1');
            expect(io._broadcast.emit).toHaveBeenCalledWith('musicman:track-ended', { roomId: 'room-1' });
        });
    });

    describe('musicman:state-changed', () => {
        it('tamper-logs when socket is not in the room', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('musicman:state-changed', { roomId: 'room-1', state: 'playing' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('musicman:state-changed'));
        });

        it('tamper-logs when state exceeds maxMusicmanState', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('musicman:state-changed', {
                roomId: 'room-1',
                state: 'x'.repeat(lim.maxMusicmanState + 1),
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('broadcasts whitelisted fields to the room for a valid event', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('musicman:state-changed', { roomId: 'room-1', state: 'playing', extra: 'stripped' });
            expect(io._broadcast.emit).toHaveBeenCalledWith('musicman:state-changed', {
                roomId: 'room-1',
                state: 'playing',
            });
        });
    });

    describe('register-rsa-key', () => {
        it('tamper-logs and blocks a key exceeding maxRsaKeySize', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io);
            trigger('register-rsa-key', { publicKey: 'x'.repeat(lim.maxRsaKeySize + 1) });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(socket.emit).not.toHaveBeenCalledWith('rsa-key-registered');
        });

        it('stores the key and emits rsa-key-registered for a valid key', () => {
            const { handler, io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { userId: 'user-001' });
            trigger('register-rsa-key', { publicKey: 'valid-pem-key' });
            expect((handler as any).rsaPublicKeys.get('user-001')).toBe('valid-pem-key');
            expect(socket.emit).toHaveBeenCalledWith('rsa-key-registered');
        });

        it('broadcasts user-rsa-key to the room when socket is in one', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, { userId: 'user-001', roomId: 'room-1' });
            trigger('register-rsa-key', { publicKey: 'valid-pem-key' });
            expect(socket._toReturn.emit).toHaveBeenCalledWith('user-rsa-key', {
                userId: 'user-001',
                publicKey: 'valid-pem-key',
            });
        });

        it('does not broadcast user-rsa-key when socket is not in any room', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io);
            trigger('register-rsa-key', { publicKey: 'valid-pem-key' });
            expect(socket._toReturn.emit).not.toHaveBeenCalledWith('user-rsa-key', expect.anything());
        });
    });

    describe('request-room-key', () => {
        it('tamper-logs when the requester is not in the room', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { id: 'socket-001', userId: 'user-001' });
            trigger('request-room-key', { roomId: 'room-1', fromUserId: 'user-002' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('request-room-key'));
        });

        it('tamper-logs when the target user is not connected at all', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, {
                id: 'socket-001',
                userId: 'user-001',
                rooms: new Set(['socket-001', 'room-1']),
            });
            trigger('request-room-key', { roomId: 'room-1', fromUserId: 'ghost-user' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('tamper-logs when the target is connected but not in the room', () => {
            const { io } = makeHandler();
            io.sockets.sockets.set('socket-002', {
                id: 'socket-002',
                userId: 'user-002',
                rooms: new Set(['socket-002']),
                emit: jest.fn(),
                on: jest.fn(),
            });
            const { trigger } = connectSocket(io, {
                id: 'socket-001',
                userId: 'user-001',
                rooms: new Set(['socket-001', 'room-1']),
            });
            trigger('request-room-key', { roomId: 'room-1', fromUserId: 'user-002' });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('forwards request-room-key to the target when both are in the room', () => {
            const { io } = makeHandler();
            const targetEmit = jest.fn();
            io.sockets.sockets.set('socket-002', {
                id: 'socket-002',
                userId: 'user-002',
                rooms: new Set(['socket-002', 'room-1']),
                emit: targetEmit,
                on: jest.fn(),
            });
            const { trigger } = connectSocket(io, {
                id: 'socket-001',
                userId: 'user-001',
                rooms: new Set(['socket-001', 'room-1']),
            });
            trigger('request-room-key', { roomId: 'room-1', fromUserId: 'user-002' });
            expect(targetEmit).toHaveBeenCalledWith('request-room-key', {
                roomId: 'room-1',
                requesterId: 'user-001',
            });
        });

        it("sends the requester's public key to the target if one is registered", () => {
            const { handler, io } = makeHandler();
            const targetEmit = jest.fn();
            io.sockets.sockets.set('socket-002', {
                id: 'socket-002',
                userId: 'user-002',
                rooms: new Set(['socket-002', 'room-1']),
                emit: targetEmit,
                on: jest.fn(),
            });
            const { trigger } = connectSocket(io, {
                id: 'socket-001',
                userId: 'user-001',
                rooms: new Set(['socket-001', 'room-1']),
            });
            (handler as any).rsaPublicKeys.set('user-001', 'requester-public-key');
            trigger('request-room-key', { roomId: 'room-1', fromUserId: 'user-002' });
            expect(targetEmit).toHaveBeenCalledWith('user-rsa-key', {
                userId: 'user-001',
                publicKey: 'requester-public-key',
            });
        });
    });

    describe('room-key-response', () => {
        it('tamper-logs when encryptedKey exceeds maxEncryptedKeySize', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('room-key-response', {
                requesterId: 'user-002',
                encryptedKey: 'x'.repeat(lim.maxEncryptedKeySize + 1),
                keyId: 'key-1',
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('room-key-response'));
        });

        it('tamper-logs when keyId exceeds maxChatKeyId', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io);
            trigger('room-key-response', {
                requesterId: 'user-002',
                encryptedKey: 'validkey',
                keyId: 'x'.repeat(lim.maxChatKeyId + 1),
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('forwards the encrypted key to the requester for a valid response', () => {
            const { io } = makeHandler();
            const requesterEmit = jest.fn();
            io.sockets.sockets.set('socket-002', {
                id: 'socket-002',
                userId: 'user-002',
                rooms: new Set<string>(),
                emit: requesterEmit,
                on: jest.fn(),
            });
            const { trigger } = connectSocket(io, { id: 'socket-001' });
            trigger('room-key-response', {
                requesterId: 'user-002',
                encryptedKey: 'enc-key-data',
                keyId: 'key-abc',
            });
            expect(requesterEmit).toHaveBeenCalledWith('room-key-response', {
                encryptedKey: 'enc-key-data',
                keyId: 'key-abc',
            });
        });

        it('does nothing when the requester is not connected', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { id: 'socket-001' });
            trigger('room-key-response', {
                requesterId: 'ghost-user',
                encryptedKey: 'enc-key-data',
                keyId: 'key-abc',
            });
            expect(errorSpy).not.toHaveBeenCalled();
        });
    });

    describe('room-chat-message', () => {
        it('tamper-logs when ciphertext exceeds maxChatCiphertext', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('room-chat-message', {
                roomId: 'room-1',
                ciphertext: 'x'.repeat(lim.maxChatCiphertext + 1),
                iv: 'iv',
                keyId: 'key',
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('room-chat-message'));
        });

        it('tamper-logs when iv exceeds maxChatIv', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('room-chat-message', {
                roomId: 'room-1',
                ciphertext: 'data',
                iv: 'x'.repeat(lim.maxChatIv + 1),
                keyId: 'key',
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('tamper-logs when keyId exceeds maxChatKeyId', () => {
            const { io } = makeHandler();
            const { trigger } = connectSocket(io, { rooms: new Set(['s', 'room-1']) });
            trigger('room-chat-message', {
                roomId: 'room-1',
                ciphertext: 'data',
                iv: 'iv',
                keyId: 'x'.repeat(lim.maxChatKeyId + 1),
            });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[TAMPER]'));
        });

        it('forwards the message with server-set identity fields for a valid payload', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, {
                userId: 'user-001',
                username: 'alice',
                rooms: new Set(['s', 'room-1']),
            });
            trigger('room-chat-message', {
                roomId: 'room-1',
                ciphertext: 'enc-data',
                iv: 'iv-val',
                keyId: 'key-1',
            });
            expect(socket._toReturn.emit).toHaveBeenCalledWith(
                'room-chat-message',
                expect.objectContaining({
                    senderUserId: 'user-001',
                    senderAlias: 'alice',
                    ciphertext: 'enc-data',
                    iv: 'iv-val',
                    keyId: 'key-1',
                    roomId: 'room-1',
                    timestamp: expect.any(String),
                })
            );
        });

        it('ignores any sender identity fields supplied by the client', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io, {
                userId: 'user-001',
                rooms: new Set(['s', 'room-1']),
            });
            trigger('room-chat-message', {
                roomId: 'room-1',
                ciphertext: 'data',
                iv: 'iv',
                keyId: 'key',
                senderUserId: 'attacker',
                senderAlias: 'evil',
            });
            const [, payload] = socket._toReturn.emit.mock.calls[0];
            expect(payload.senderUserId).toBe('user-001');
            expect(payload.senderUserId).not.toBe('attacker');
        });
    });

    describe('hub:join', () => {
        it('joins the hub socket room when membership is confirmed', async () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io);
            await trigger('hub:join', 'hub-abc');
            expect(socket.join).toHaveBeenCalledWith('hub:hub-abc');
        });

        it('emits hub-join-error and does not join when membership is denied', async () => {
            const { io, roomManager } = makeHandler();
            roomManager.checkHubMembership.mockResolvedValueOnce(false);
            const { socket, trigger } = connectSocket(io);
            await trigger('hub:join', 'hub-abc');
            expect(socket.join).not.toHaveBeenCalled();
            expect(socket.emit).toHaveBeenCalledWith('hub-join-error', expect.objectContaining({
                message: expect.any(String),
            }));
        });

        it('ignores non-string hubId', async () => {
            const { io, roomManager } = makeHandler();
            const { trigger } = connectSocket(io);
            await trigger('hub:join', 12345);
            expect(roomManager.checkHubMembership).not.toHaveBeenCalled();
        });
    });

    describe('hub:leave', () => {
        it('calls socket.leave with the hub room', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io);
            trigger('hub:leave', 'hub-abc');
            expect(socket.leave).toHaveBeenCalledWith('hub:hub-abc');
        });

        it('ignores non-string hubId', () => {
            const { io } = makeHandler();
            const { socket, trigger } = connectSocket(io);
            trigger('hub:leave', null);
            expect(socket.leave).not.toHaveBeenCalled();
        });
    });

    describe('checkSocketRateLimit', () => {
        it('returns true when under the limit', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io);
            expect(handler.checkSocketRateLimit(socket as any, 'action', 5, 60000)).toBe(true);
        });

        it('returns false and emits rate-limit-exceeded when over the limit', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io);
            for (let i = 0; i < 5; i++) {
                handler.checkSocketRateLimit(socket as any, 'action', 5, 60000);
            }
            const result = handler.checkSocketRateLimit(socket as any, 'action', 5, 60000);
            expect(result).toBe(false);
            expect(socket.emit).toHaveBeenCalledWith('rate-limit-exceeded', expect.objectContaining({
                action: 'action',
                message: 'Too many requests, please slow down',
                retryAfter: expect.any(Number),
            }));
        });

        it('resets the counter after the window expires', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io);
            for (let i = 0; i < 5; i++) {
                handler.checkSocketRateLimit(socket as any, 'action', 5, 60000);
            }
            const bucket = (handler as any).socketRateLimits.get('user-001') as Map<string, any>;
            bucket.get('action').resetAt = Date.now() - 1;
            expect(handler.checkSocketRateLimit(socket as any, 'action', 5, 60000)).toBe(true);
        });

        it('returns false when no bucket exists for the user', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io);
            (handler as any).socketRateLimits.delete('user-001');
            expect(handler.checkSocketRateLimit(socket as any, 'action', 5, 60000)).toBe(false);
        });
    });

    describe('handleDisconnect', () => {
        it('emits user-disconnected and calls leaveRoom when socket is in a room', () => {
            const { handler, io, roomManager } = makeHandler();
            const { socket } = connectSocket(io, { roomId: 'room-1' });
            handler.handleDisconnect(socket as any);
            expect(socket._toReturn.emit).toHaveBeenCalledWith('user-disconnected', socket.peerId);
            expect(roomManager.leaveRoom).toHaveBeenCalledWith(socket, 'room-1');
        });

        it('calls removeUser when socket is not in any room', () => {
            const { handler, io, roomManager } = makeHandler();
            const { socket } = connectSocket(io);
            handler.handleDisconnect(socket as any);
            expect(roomManager.removeUser).toHaveBeenCalledWith(socket.id);
        });

        it('deletes the rate limit bucket when the user has no remaining sockets', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io, { id: 'socket-001', userId: 'user-lone' });
            handler.handleDisconnect(socket as any);
            expect((handler as any).socketRateLimits.has('user-lone')).toBe(false);
        });

        it('preserves the rate limit bucket when other sockets for the same user remain', () => {
            const { handler, io } = makeHandler();
            connectSocket(io, { id: 'socket-001', userId: 'user-multi' });
            const { socket: s2 } = connectSocket(io, { id: 'socket-002', userId: 'user-multi' });
            handler.handleDisconnect(s2 as any);
            expect((handler as any).socketRateLimits.has('user-multi')).toBe(true);
        });

        it('removes the RSA public key on disconnect', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io, { userId: 'user-001' });
            (handler as any).rsaPublicKeys.set('user-001', 'some-key');
            handler.handleDisconnect(socket as any);
            expect((handler as any).rsaPublicKeys.has('user-001')).toBe(false);
        });
    });

    describe('handleLeaveRoom', () => {
        it('does nothing when socket has no roomId', () => {
            const { handler, io, roomManager } = makeHandler();
            const { socket } = connectSocket(io);
            handler.handleLeaveRoom(socket as any);
            expect(roomManager.leaveRoom).not.toHaveBeenCalled();
        });

        it('emits user-disconnected and calls leaveRoom', () => {
            const { handler, io, roomManager } = makeHandler();
            const { socket } = connectSocket(io, { roomId: 'room-1' });
            handler.handleLeaveRoom(socket as any);
            expect(socket._toReturn.emit).toHaveBeenCalledWith('user-disconnected', socket.peerId);
            expect(roomManager.leaveRoom).toHaveBeenCalledWith(socket, 'room-1');
        });

        it('clears socket.roomId after leaving', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io, { roomId: 'room-1' });
            handler.handleLeaveRoom(socket as any);
            expect(socket.roomId).toBeUndefined();
        });

        it('emits peer-screenshare-stopped and removes the share when the socket was screensharing', () => {
            const { handler, io, roomManager } = makeHandler();
            const { socket } = connectSocket(io, { roomId: 'room-1' });
            const assignedPeerId = (socket.emit as jest.Mock).mock.calls
                .find(([e]: [string]) => e === 'peer-assigned')?.[1]?.peerId as string;
            const activeScreenShares = new Map([
                [assignedPeerId, { peerId: assignedPeerId, screenPeerId: 'screen-001' }],
            ]);
            roomManager.rooms.set('room-1', {
                id: 'room-1',
                users: new Map(),
                createdBy: 'x',
                createdAt: Date.now(),
                activeScreenShares,
            });
            handler.handleLeaveRoom(socket as any);
            expect(socket._toReturn.emit).toHaveBeenCalledWith('peer-screenshare-stopped', {
                peerId: assignedPeerId,
                screenPeerId: 'screen-001',
            });
            expect(activeScreenShares.has(assignedPeerId)).toBe(false);
        });
    });

    describe('findSocketByPeerId', () => {
        it('returns the socket with the matching peerId', () => {
            const { handler, io } = makeHandler();
            const fakeSocket = { id: 'raw-s', peerId: 'peer-xyz', userId: 'u' };
            io.sockets.sockets.set('raw-s', fakeSocket);
            expect(handler.findSocketByPeerId('peer-xyz')).toBe(fakeSocket);
        });

        it('returns null when no socket has the given peerId', () => {
            const { handler, io } = makeHandler();
            connectSocket(io);
            expect(handler.findSocketByPeerId('non-existent')).toBeNull();
        });
    });

    describe('findSocketByUserId', () => {
        it('returns the socket with the matching userId', () => {
            const { handler, io } = makeHandler();
            const { socket } = connectSocket(io, { userId: 'user-abc' });
            expect(handler.findSocketByUserId('user-abc')).toBe(socket);
        });

        it('returns null when no socket has the given userId', () => {
            const { handler, io } = makeHandler();
            connectSocket(io);
            expect(handler.findSocketByUserId('ghost')).toBeNull();
        });
    });
});
