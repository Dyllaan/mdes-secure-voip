jest.mock('../Auth', () => ({
    register:             jest.fn().mockResolvedValue(undefined),
    login:                jest.fn().mockResolvedValue('test-token'),
    fetchTurnCredentials: jest.fn().mockResolvedValue(undefined),
    startTokenRefresh:    jest.fn(),
    stopTokenRefresh:     jest.fn(),
    getToken:             jest.fn().mockReturnValue('test-token'),
    getTurnCredentials:   jest.fn().mockReturnValue({ username: 'u', password: 'p', ttl: 3600 }),
}));

const mockSessionState = (roomId: string, url: string) => ({
    roomId,
    queue: [{ id: 'item-1', url, title: 'Test', channel: 'YouTube', duration: '3:00', durationMs: 180000, source: 'youtube' }],
    currentIndex: 0,
    currentTrack: { id: 'item-1', url, title: 'Test', channel: 'YouTube', duration: '3:00', durationMs: 180000, source: 'youtube' },
    playing: true,
    paused: false,
    positionMs: 1000,
    videoMode: false,
    screenPeerId: null,
    url,
});

const makeMockSession = (roomId: string, url: string) => ({
    roomId,
    videoMode: false,
    start:      jest.fn().mockResolvedValue(undefined),
    destroy:    jest.fn(),
    pause:      jest.fn(),
    resume:     jest.fn(),
    seek:       jest.fn(),
    playNow:    jest.fn(),
    playItem:   jest.fn(),
    addItems:   jest.fn(),
    removeItem: jest.fn(),
    clear:      jest.fn(),
    next:       jest.fn(),
    reorder:    jest.fn(),
    shuffle:    jest.fn(),
    getState:   jest.fn().mockReturnValue(mockSessionState(roomId, url)),
});

type MockSession = ReturnType<typeof makeMockSession>;

let capturedOnDisposed: ((roomId: string, reason: string) => void) | null = null;

jest.mock('../music/MusicSession', () => ({
    MusicSession: jest.fn().mockImplementation((roomId: string, _bot: unknown, items: Array<{ url: string }>, onDisposed: (roomId: string, reason: string) => void) => {
        capturedOnDisposed = onDisposed;
        return makeMockSession(roomId, items[0]?.url ?? '');
    }),
}));

jest.mock('../instances/BotInstance', () => ({
    BotInstance: jest.fn().mockImplementation((roomId: string, url: string) => ({
        roomId,
        url,
        videoMode: false,
        start:                  jest.fn().mockResolvedValue(undefined),
        destroy:                jest.fn(),
        setAutoLeaveCallback:   jest.fn(),
        setTrackEndedCallback:  jest.fn(),
        setDestroyCallback:     jest.fn(),
        emitRoomEvent:          jest.fn(),
        getStatus:              jest.fn().mockReturnValue({ playing: true, paused: false, positionMs: 0, url }),
    })),
}));

jest.mock('../instances/AVBotInstance', () => ({
    AVBotInstance: jest.fn().mockImplementation((roomId: string, url: string) => ({
        roomId,
        url,
        videoMode: true,
        start:                  jest.fn().mockResolvedValue(undefined),
        destroy:                jest.fn(),
        setAutoLeaveCallback:   jest.fn(),
        setTrackEndedCallback:  jest.fn(),
        setDestroyCallback:     jest.fn(),
        emitRoomEvent:          jest.fn(),
        getStatus:              jest.fn().mockReturnValue({ playing: true, paused: false, positionMs: 0, url }),
    })),
}));

jest.mock('../HubHandler', () => ({
    HubHandler: { joinHub: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('express', () => {
    const actualExpress = jest.requireActual<typeof import('express')>('express');
    const wrapper = () => {
        const app = actualExpress();
        app.listen = jest.fn().mockImplementation((_port: unknown, cb?: () => void) => {
            cb?.();
            return { on: jest.fn(), close: jest.fn() } as any;
        });
        return app;
    };
    Object.assign(wrapper, actualExpress);
    return wrapper;
});

import request from 'supertest';
import { createTestJwt } from './helpers/createJwt';

global.fetch = jest.fn().mockResolvedValue({ ok: true }) as typeof fetch;

const { app } = require('../index') as typeof import('../index');

function makeJwt(sub: string, opts: { expired?: boolean } = {}): string {
    return createTestJwt({
        sub,
        exp: opts.expired
            ? Math.floor(Date.now() / 1000) - 3600
            : Math.floor(Date.now() / 1000) + 3600,
    });
}

function authHeader(sub = `user-${Math.random()}`) {
    return { Authorization: `Bearer ${makeJwt(sub)}` };
}

function captureStderrLogs() {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(chunk.toString());
        return true;
    }) as typeof process.stderr.write);

    return {
        spy,
        entries: () => writes
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
}

function allowRoomAccess(roomIds: string[] = []) {
    return jest.fn().mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        return { ok: roomIds.some((roomId) => url.includes(`/channels/${roomId}/access`)) };
    });
}

const ALLOWED_URL    = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const DISALLOWED_URL = 'https://evil.com/malware.mp3';

let mockFetch: jest.Mock;

beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as typeof fetch;
    capturedOnDisposed = null;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('Express routes (index.ts)', () => {
    describe('POST /join', () => {
        it('should return 400 when roomId is missing', async () => {
            const res = await request(app).post('/join').set(authHeader()).send({ url: ALLOWED_URL });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/roomId/);
        });

        it('should return 400 when url is missing', async () => {
            const res = await request(app).post('/join').set(authHeader()).send({ roomId: 'room1' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/url/);
        });

        it('should return 400 when url domain is not allowed', async () => {
            const res = await request(app).post('/join').set(authHeader()).send({ roomId: 'room1', url: DISALLOWED_URL });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/domain/i);
        });

        it('should return 401 when Authorization header is missing', async () => {
            const res = await request(app).post('/join').send({ roomId: 'room1', url: ALLOWED_URL });
            expect(res.status).toBe(401);
        });

        it('should return 401 when JWT signature is invalid', async () => {
            const res = await request(app).post('/join')
                .set({ Authorization: 'Bearer header.payload.badsignature' })
                .send({ roomId: 'room1', url: ALLOWED_URL });
            expect(res.status).toBe(401);
        });

        it('should return 401 when JWT is expired', async () => {
            const res = await request(app).post('/join')
                .set({ Authorization: `Bearer ${makeJwt('expired-user', { expired: true })}` })
                .send({ roomId: 'room1', url: ALLOWED_URL });
            expect(res.status).toBe(401);
        });

        it('should return 403 when room access is denied', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).post('/join').set(authHeader()).send({ roomId: 'room1', url: ALLOWED_URL });
            expect(res.status).toBe(403);
        });

        it('should return 200 with ok:true and session state on success', async () => {
            const roomId = `room-new-${Math.random()}`;
            const res = await request(app).post('/join').set(authHeader()).send({ roomId, url: ALLOWED_URL });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.session).toBeDefined();
            expect(res.body.roomId).toBe(roomId);
        });

        it('should return 409 when a bot is already in the room', async () => {
            const sub    = `user-dup-${Math.random()}`;
            const roomId = `room-dup-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            const res = await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            expect(res.status).toBe(409);
        });

        it('should return 429 on the 6th request within 60s from same user', async () => {
            const sub     = `rate-limit-user-${Math.random()}`;
            const headers = { Authorization: `Bearer ${makeJwt(sub)}` };
            for (let i = 0; i < 5; i++) {
                await request(app).post('/join').set(headers)
                    .send({ roomId: `rl-room-${i}-${Math.random()}`, url: ALLOWED_URL });
            }
            const res = await request(app).post('/join').set(headers)
                .send({ roomId: `rl-room-5-${Math.random()}`, url: ALLOWED_URL });
            expect(res.status).toBe(429);
        });

        it('should treat non-boolean videoMode as false', async () => {
            const roomId = `room-vm-${Math.random()}`;
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId, url: ALLOWED_URL, videoMode: 'yes' });
            expect(res.status).toBe(200);
            expect(res.body.videoMode).toBe(false);
        });

        it('should return 400 when roomId exceeds 128 chars', async () => {
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId: 'a'.repeat(129), url: ALLOWED_URL });
            expect(res.status).toBe(400);
        });

        it('should return 400 when url exceeds 2048 chars', async () => {
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId: 'room1', url: 'https://youtube.com/' + 'a'.repeat(2048) });
            expect(res.status).toBe(400);
        });
    });

    describe('POST /play', () => {
        it('should return 400 when url is missing', async () => {
            const res = await request(app).post('/play').set(authHeader()).send({ roomId: 'room1' });
            expect(res.status).toBe(400);
        });

        it('should return 400 when url domain is not permitted', async () => {
            const res = await request(app).post('/play').set(authHeader()).send({ roomId: 'room1', url: DISALLOWED_URL });
            expect(res.status).toBe(400);
        });

        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).post('/play').send({ roomId: 'room1', url: ALLOWED_URL });
            expect(res.status).toBe(401);
        });

        it('should return 403 when room access denied', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).post('/play').set(authHeader()).send({ roomId: 'room-play', url: ALLOWED_URL });
            expect(res.status).toBe(403);
        });

        it('should return 200 action:changeTrack if bot already in room', async () => {
            const sub    = `user-ct-${Math.random()}`;
            const roomId = `room-play-existing-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            const res = await request(app).post('/play').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            expect(res.status).toBe(200);
            expect(res.body.action).toBe('changeTrack');
        });

        it('should return 200 action:join if no bot exists', async () => {
            const res = await request(app).post('/play').set(authHeader()).send({ roomId: `room-play-new-${Math.random()}`, url: ALLOWED_URL });
            expect(res.status).toBe(200);
            expect(res.body.action).toBe('join');
        });

        it('should return 400 when roomId exceeds 128 chars', async () => {
            const res = await request(app).post('/play').set(authHeader())
                .send({ roomId: 'a'.repeat(129), url: ALLOWED_URL });
            expect(res.status).toBe(400);
        });
    });

    describe('POST /leave', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).post('/leave').send({ roomId: 'room1' });
            expect(res.status).toBe(401);
        });

        it('should return 400 when roomId is missing', async () => {
            const res = await request(app).post('/leave').set(authHeader()).send({});
            expect(res.status).toBe(400);
        });

        it('should return 404 when no bot is in the room', async () => {
            const res = await request(app).post('/leave').set(authHeader()).send({ roomId: 'nonexistent-room' });
            expect(res.status).toBe(404);
        });

        it('should return 200 and call session.destroy() when session exists', async () => {
            const sub    = `user-leave-${Math.random()}`;
            const roomId = `room-to-leave-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            const res = await request(app).post('/leave').set(authHeader(sub)).send({ roomId });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('should return 403 when caller is not a room member', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).post('/leave').set(authHeader()).send({ roomId: 'some-room' });
            expect(res.status).toBe(403);
        });
    });

    describe('POST /pause', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).post('/pause').send({ roomId: 'room1' });
            expect(res.status).toBe(401);
        });

        it('should return 404 when no session in room', async () => {
            const res = await request(app).post('/pause').set(authHeader()).send({ roomId: 'no-bot' });
            expect(res.status).toBe(404);
        });

        it('should return 200 and call session.pause() when session exists', async () => {
            const sub    = `user-pause-${Math.random()}`;
            const roomId = `room-pause-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            const res = await request(app).post('/pause').set(authHeader(sub)).send({ roomId });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('should return 403 when caller is not a room member', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).post('/pause').set(authHeader()).send({ roomId: 'some-room' });
            expect(res.status).toBe(403);
        });
    });

    describe('POST /resume', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).post('/resume').send({ roomId: 'room1' });
            expect(res.status).toBe(401);
        });

        it('should return 404 when no session in room', async () => {
            const res = await request(app).post('/resume').set(authHeader()).send({ roomId: 'no-bot' });
            expect(res.status).toBe(404);
        });

        it('should return 200 and call session.resume() when session exists', async () => {
            const sub    = `user-resume-${Math.random()}`;
            const roomId = `room-resume-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            const res = await request(app).post('/resume').set(authHeader(sub)).send({ roomId });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('should return 403 when caller is not a room member', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).post('/resume').set(authHeader()).send({ roomId: 'some-room' });
            expect(res.status).toBe(403);
        });
    });

    describe('POST /seek', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).post('/seek').send({ roomId: 'room1', seconds: 30 });
            expect(res.status).toBe(401);
        });

        it('should return 400 when roomId is missing', async () => {
            const res = await request(app).post('/seek').set(authHeader()).send({ seconds: 30 });
            expect(res.status).toBe(400);
        });

        it('should return 400 when seconds is undefined', async () => {
            const res = await request(app).post('/seek').set(authHeader()).send({ roomId: 'room1' });
            expect(res.status).toBe(400);
        });

        it('should return 400 when seconds is a string', async () => {
            const res = await request(app).post('/seek').set(authHeader()).send({ roomId: 'room1', seconds: 'thirty' });
            expect(res.status).toBe(400);
        });

        it('should return 400 when seconds is Infinity', async () => {
            const res = await request(app).post('/seek').set(authHeader()).send({ roomId: 'room1', seconds: Infinity });
            expect(res.status).toBe(400);
        });

        it('should return 404 when no session in room', async () => {
            const res = await request(app).post('/seek').set(authHeader()).send({ roomId: 'no-bot', seconds: 30 });
            expect(res.status).toBe(404);
        });

        it('should return 200 and call session.seek(seconds * 1000) when session exists', async () => {
            const sub    = `user-seek-${Math.random()}`;
            const roomId = `room-seek-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });

            const { MusicSession } = require('../music/MusicSession');
            const mockSession = (MusicSession as jest.Mock).mock.results.at(-1)?.value as MockSession;

            const res = await request(app).post('/seek').set(authHeader(sub)).send({ roomId, seconds: 45 });
            expect(res.status).toBe(200);
            expect(res.body.seconds).toBe(45);
            expect(mockSession.seek).toHaveBeenCalledWith(45000);
        });

        it('should clamp negative seconds to 0', async () => {
            const sub    = `user-seek-neg-${Math.random()}`;
            const roomId = `room-seek-neg-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });

            const { MusicSession } = require('../music/MusicSession');
            const mockSession = (MusicSession as jest.Mock).mock.results.at(-1)?.value as MockSession;

            await request(app).post('/seek').set(authHeader(sub)).send({ roomId, seconds: -10 });
            expect(mockSession.seek).toHaveBeenCalledWith(0);
        });

        it('should return 403 when caller is not a room member', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).post('/seek').set(authHeader()).send({ roomId: 'some-room', seconds: 45 });
            expect(res.status).toBe(403);
        });
    });

    describe('GET /rooms', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).get('/rooms');
            expect(res.status).toBe(401);
        });

        it('should return { rooms: [] } when no accessible rooms', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).get('/rooms').set(authHeader());
            expect(res.status).toBe(200);
            expect(res.body.rooms).toEqual([]);
        });
    });

    describe('GET /status/:roomId', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).get('/status/room1');
            expect(res.status).toBe(401);
        });

        it('should return 404 when no session in the room', async () => {
            const res = await request(app).get('/status/nonexistent').set(authHeader());
            expect(res.status).toBe(404);
        });

        it('should return session.getState() on success', async () => {
            const sub    = `user-status-${Math.random()}`;
            const roomId = `room-status-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });
            const res = await request(app).get(`/status/${roomId}`).set(authHeader(sub));
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ playing: expect.any(Boolean), url: ALLOWED_URL });
        });

        it('should return 403 when caller is not a room member', async () => {
            mockFetch = allowRoomAccess([]);
            global.fetch = mockFetch as typeof fetch;
            const res = await request(app).get('/status/some-room').set(authHeader());
            expect(res.status).toBe(403);
        });
    });

    describe('isAllowedUrl (via /join endpoint)', () => {
        it('should permit youtube.com URLs', async () => {
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId: `room-yt1-${Math.random()}`, url: 'https://www.youtube.com/watch?v=test' });
            expect(res.status).not.toBe(400);
        });

        it('should permit youtu.be URLs', async () => {
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId: `room-ytbe-${Math.random()}`, url: 'https://youtu.be/test' });
            expect(res.status).not.toBe(400);
        });

        it('should reject URLs from non-allowed domains', async () => {
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId: 'room-evil', url: 'https://evil.com/file.mp3' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/domain/i);
        });

        it('should reject malformed URLs', async () => {
            const logCapture = captureStderrLogs();
            const res = await request(app).post('/join').set(authHeader())
                .send({ roomId: 'room-bad', url: 'not-a-url' });
            expect(res.status).toBe(400);
            const entry = logCapture.entries().find((log) => log.message === 'request.rejected');
            expect(entry).toMatchObject({
                context: 'http.routes.request',
                route: '/join',
                rejectionReason: 'malformed_url',
                roomId: 'room-bad',
                url: 'not-a-url',
            });
            logCapture.spy.mockRestore();
        });
    });

    describe('JWT verification (extractUserId)', () => {
        it('should return 401 when Authorization header is missing', async () => {
            const res = await request(app).get('/rooms');
            expect(res.status).toBe(401);
        });

        it('should return 401 when token has wrong number of parts', async () => {
            const res = await request(app).get('/rooms').set({ Authorization: 'Bearer only.two' });
            expect(res.status).toBe(401);
        });

        it('should return 200 for a valid, unexpired token', async () => {
            const res = await request(app).get('/rooms').set(authHeader());
            expect(res.status).toBe(200);
        });
    });

    describe('session lifecycle via onDisposed callback', () => {
        it('should remove the session from the map when onDisposed fires', async () => {
            const sub    = `user-disposed-${Math.random()}`;
            const roomId = `room-disposed-${Math.random()}`;
            await request(app).post('/join').set(authHeader(sub)).send({ roomId, url: ALLOWED_URL });

            expect(capturedOnDisposed).not.toBeNull();
            capturedOnDisposed!(roomId, 'test_reason');

            const res = await request(app).get(`/status/${roomId}`).set(authHeader(sub));
            expect(res.status).toBe(404);
        });
    });

    describe('POST /resolve', () => {
        it('should return 401 when unauthenticated', async () => {
            const res = await request(app).post('/resolve').send({ url: ALLOWED_URL });
            expect(res.status).toBe(401);
        });

        it('should return 400 when url is missing', async () => {
            const res = await request(app).post('/resolve').set(authHeader()).send({});
            expect(res.status).toBe(400);
        });

        it('should return 400 for disallowed domain', async () => {
            const res = await request(app).post('/resolve').set(authHeader()).send({ url: DISALLOWED_URL });
            expect(res.status).toBe(400);
        });

        it('should return 400 when url exceeds max length', async () => {
            const res = await request(app).post('/resolve').set(authHeader())
                .send({ url: 'https://youtube.com/' + 'a'.repeat(2048) });
            expect(res.status).toBe(400);
        });
    });
});