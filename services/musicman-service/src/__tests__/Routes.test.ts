import request from 'supertest';
import express from 'express';
import { createRouter } from '../http/Routes';
import { BotInstance } from '../instances/BotInstance';
import { AVBotInstance } from '../instances/AVBotInstance';
import { MusicSession } from '../music/MusicSession';
import { createRefreshJwt, createTestJwt } from './helpers/createJwt';

jest.mock('../instances/BotInstance');
jest.mock('../instances/AVBotInstance');
jest.mock('../HubHandler', () => ({
    HubHandler: { joinHub: jest.fn() },
}));
jest.mock('../Auth', () => ({
    getToken: jest.fn().mockReturnValue('mock-token'),
    getTurnCredentials: jest.fn().mockReturnValue({}),
}));

function authHeader(payload: Record<string, unknown> = {}): string {
    return `Bearer ${createTestJwt({ sub: `user-${Math.random()}`, ...payload })}`;
}

function mockRoomAccess(allowedRooms: string[] = []) {
    return jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        const isAllowed = allowedRooms.some((roomId) => url.includes(`/channels/${roomId}/access`));
        return { ok: isAllowed, status: isAllowed ? 200 : 403 } as Response;
    });
}

function mockBot(overrides: Partial<BotInstance> = {}): BotInstance & AVBotInstance {
    return {
        start: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        seek: jest.fn(),
        changeTrack: jest.fn(),
        emitRoomEvent: jest.fn(),
        getStatus: jest.fn().mockReturnValue({ playing: true, paused: false, positionMs: 0, url: 'https://youtube.com/watch?v=abc' }),
        setAutoLeaveCallback: jest.fn(),
        setTrackEndedCallback: jest.fn(),
        setDestroyCallback: jest.fn(),
        videoMode: false,
        ...overrides,
    } as unknown as BotInstance & AVBotInstance;
}

function mockSession(overrides: Partial<MusicSession> = {}): MusicSession {
    return {
        start: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        seek: jest.fn(),
        addItems: jest.fn(),
        playNow: jest.fn(),
        playItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
        next: jest.fn(),
        reorder: jest.fn(),
        shuffle: jest.fn(),
        getState: jest.fn().mockReturnValue({
            roomId: 'r1',
            queue: [{
                id: 'yt-track-1',
                url: 'https://youtube.com/watch?v=abc',
                title: 'Test Track',
                channel: 'Test Channel',
                duration: '3:15',
                durationMs: 195000,
            }],
            currentIndex: 0,
            currentTrack: {
                id: 'yt-track-1',
                url: 'https://youtube.com/watch?v=abc',
                title: 'Test Track',
                channel: 'Test Channel',
                duration: '3:15',
                durationMs: 195000,
            },
            playing: true,
            paused: false,
            positionMs: 0,
            url: 'https://youtube.com/watch?v=abc',
            videoMode: false,
            screenPeerId: null,
        }),
        videoMode: false,
        ...overrides,
    } as unknown as MusicSession;
}

function makeQueueItem(id: string) {
    return {
        id,
        url: `https://youtube.com/watch?v=${id}`,
        title: `Track ${id}`,
        channel: 'Test Channel',
        duration: '3:15',
        durationMs: 195000,
        source: 'youtube' as const,
    };
}

let sessions: Map<string, MusicSession>;
let app: express.Express;

beforeEach(() => {
    sessions = new Map();
    app = express();
    app.use(express.json());
    app.use(createRouter(sessions));
    jest.clearAllMocks();
    mockRoomAccess(['r1', 'r2']);
    (BotInstance as jest.MockedClass<typeof BotInstance>).mockImplementation(() => mockBot());
    (AVBotInstance as jest.MockedClass<typeof AVBotInstance>).mockImplementation(() => mockBot({ videoMode: true }));
});

describe('GET /health', () => {
    it('returns service health without auth', async () => {
        sessions.set('r1', mockSession());

        const res = await request(app).get('/health').expect(200);

        expect(res.body).toEqual({
            status: 'ok',
            roomCount: 1,
            activeRoomIds: ['r1'],
        });
    });
});

describe('POST /join', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).post('/join')
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(401);
    });

    it('returns 409 when bot already in room', async () => {
        sessions.set('r1', mockSession());
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(409);
    });

    it('starts BotInstance and creates a session', async () => {
        const res = await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(200);

        expect(BotInstance).toHaveBeenCalled();
        expect(AVBotInstance).not.toHaveBeenCalled();
        expect(sessions.has('r1')).toBe(true);
        expect(res.body.session.roomId).toBe('r1');
    });

    it('starts AVBotInstance for video mode', async () => {
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc', videoMode: true })
            .expect(200);

        expect(AVBotInstance).toHaveBeenCalled();
    });
});

describe('POST /play', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('plays immediately in an existing session', async () => {
        const session = mockSession({ playNow: jest.fn() });
        sessions.set('r1', session);

        const res = await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(200);

        expect(session.playNow).toHaveBeenCalled();
        expect(res.body.action).toBe('changeTrack');
    });

    it('creates a new session when none exists', async () => {
        await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(200);

        expect(sessions.has('r1')).toBe(true);
    });
});

describe('Queue routes', () => {
    const queueItem = {
        id: 'yt-track-1',
        url: 'https://youtube.com/watch?v=abc',
        title: 'Test Track',
        channel: 'Test Channel',
        duration: '3:15',
        durationMs: 195000,
    };

    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('creates a session on POST /queue/add when none exists', async () => {
        const res = await request(app).post('/queue/add')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', items: [queueItem] })
            .expect(200);

        expect(sessions.has('r1')).toBe(true);
        expect(res.body.session.queue).toHaveLength(1);
    });

    it('appends items to an existing session', async () => {
        const session = mockSession({ addItems: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/queue/add')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', items: [queueItem] })
            .expect(200);

        expect(session.addItems).toHaveBeenCalledWith([queueItem]);
    });

    it('plays a specific queued item', async () => {
        const session = mockSession({ playItem: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/queue/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', itemId: 'yt-track-1' })
            .expect(200);

        expect(session.playItem).toHaveBeenCalledWith('yt-track-1');
    });

    it('removes a queued item', async () => {
        const session = mockSession({ removeItem: jest.fn().mockReturnValue({}) });
        sessions.set('r1', session);

        await request(app).post('/queue/remove')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', itemId: 'yt-track-1' })
            .expect(200);

        expect(session.removeItem).toHaveBeenCalledWith('yt-track-1');
    });

    it('clears the queue', async () => {
        const session = mockSession({ clear: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/queue/clear')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);

        expect(session.clear).toHaveBeenCalled();
    });

    it('reorders the queue', async () => {
        const session = mockSession({ reorder: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/queue/reorder')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', itemIds: ['yt-track-1'] })
            .expect(200);

        expect(session.reorder).toHaveBeenCalledWith(['yt-track-1']);
    });

    it('shuffles the queue', async () => {
        const session = mockSession({ shuffle: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/queue/shuffle')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);

        expect(session.shuffle).toHaveBeenCalled();
    });

    it('advances to the next track', async () => {
        const session = mockSession({ next: jest.fn().mockReturnValue({}) });
        sessions.set('r1', session);

        await request(app).post('/queue/next')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);

        expect(session.next).toHaveBeenCalled();
    });
});

describe('Playback control routes', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('destroys the session on leave', async () => {
        const session = mockSession({ destroy: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/leave')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);

        expect(session.destroy).toHaveBeenCalledWith('manual');
    });

    it('pauses and resumes through the session', async () => {
        const session = mockSession({ pause: jest.fn(), resume: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/pause')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);
        await request(app).post('/resume')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);

        expect(session.pause).toHaveBeenCalled();
        expect(session.resume).toHaveBeenCalled();
    });

    it('seeks via the session', async () => {
        const session = mockSession({ seek: jest.fn() });
        sessions.set('r1', session);

        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: 30 })
            .expect(200);

        expect(session.seek).toHaveBeenCalledWith(30_000);
    });
});

describe('GET /rooms and /status/:roomId', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns only rooms accessible to the caller', async () => {
        sessions.set('r1', mockSession());
        sessions.set('r2', mockSession());

        const res = await request(app).get('/rooms')
            .set('Authorization', authHeader())
            .expect(200);

        expect(res.body.rooms).toEqual(['r1']);
    });

    it('returns full room session status', async () => {
        sessions.set('r1', mockSession());

        const res = await request(app).get('/status/r1')
            .set('Authorization', authHeader())
            .expect(200);

        expect(res.body).toMatchObject({
            roomId: 'r1',
            queue: expect.any(Array),
            currentIndex: 0,
            playing: true,
        });
    });

    it('keeps the current track on B after duplicate stale track-ended noise', async () => {
        const bot = mockBot({
            getStatus: jest.fn().mockReturnValue({
                playing: true,
                paused: false,
                positionMs: 0,
                url: 'https://youtube.com/watch?v=a',
            }),
        });
        const session = new MusicSession(
            'r1',
            bot as unknown as BotInstance,
            [makeQueueItem('a'), makeQueueItem('b'), makeQueueItem('c')],
            jest.fn(),
        );
        sessions.set('r1', session);

        const trackEndedCb = (bot.setTrackEndedCallback as jest.Mock).mock.calls[0][0] as () => void;
        const nowSpy = jest.spyOn(Date, 'now');

        nowSpy.mockReturnValue(5_000);
        trackEndedCb();
        nowSpy.mockReturnValue(5_100);
        trackEndedCb();

        const res = await request(app).get('/status/r1')
            .set('Authorization', authHeader())
            .expect(200);

        expect(res.body).toMatchObject({
            roomId: 'r1',
            currentIndex: 0,
            currentTrack: expect.objectContaining({ id: 'b' }),
        });
        expect(res.body.queue).toHaveLength(2);
        expect(res.body.queue.map((item: { id: string }) => item.id)).toEqual(['b', 'c']);
        expect(bot.changeTrack).toHaveBeenCalledTimes(1);
        expect(bot.changeTrack).toHaveBeenCalledWith('https://youtube.com/watch?v=b');

        nowSpy.mockRestore();
    });

    it('returns 404 when no session exists', async () => {
        await request(app).get('/status/r1')
            .set('Authorization', authHeader())
            .expect(404);
    });

    it('returns 401 for refresh tokens', async () => {
        await request(app).get('/rooms')
            .set('Authorization', `Bearer ${createRefreshJwt()}`)
            .expect(401);
    });
});
