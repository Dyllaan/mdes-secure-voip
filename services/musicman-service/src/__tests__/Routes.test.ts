import request from 'supertest';
import express from 'express';
import { createRouter } from '../http/Routes';
import { BotInstance } from '../instances/BotInstance';
import { AVBotInstance } from '../instances/AVBotInstance';
import { createRefreshJwt, createTestJwt } from './helpers/createJwt';

jest.mock('../instances/BotInstance');
jest.mock('../instances/AVBotInstance');
jest.mock('../HubHandler', () => ({
    HubHandler: { joinHub: jest.fn() },
}));
jest.mock('../Auth', () => ({
    getToken:           jest.fn().mockReturnValue('mock-token'),
    getTurnCredentials: jest.fn().mockReturnValue({}),
}));

import { HubHandler } from '../HubHandler';

function authHeader(payload: Record<string, unknown> = {}): string {
    return `Bearer ${createTestJwt({ sub: `user-${Math.random()}`, ...payload })}`;
}

function mockRoomAccess(allowedRooms: string[] = []) {
    return jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        const isAllowed = allowedRooms.some((roomId) => url.includes(`/channels/${roomId}/access`));
        return { ok: isAllowed } as Response;
    });
}

function mockBot(overrides: Partial<BotInstance> = {}): BotInstance & AVBotInstance {
    return {
        start:                jest.fn().mockResolvedValue(undefined),
        destroy:              jest.fn(),
        pause:                jest.fn(),
        resume:               jest.fn(),
        seek:                 jest.fn(),
        changeTrack:          jest.fn(),
        getStatus:            jest.fn().mockReturnValue({ playing: true }),
        setAutoLeaveCallback: jest.fn(),
        videoMode:            false,
        ...overrides,
    } as unknown as BotInstance & AVBotInstance;
}

let bots: Map<string, BotInstance>;
let app: express.Express;

beforeEach(() => {
    bots = new Map();
    app  = express();
    app.use(express.json());
    app.use(createRouter(bots));
    jest.clearAllMocks();
    mockRoomAccess(['r1', 'r2']);

    (BotInstance as jest.MockedClass<typeof BotInstance>).mockImplementation(() => mockBot());
    (AVBotInstance as jest.MockedClass<typeof AVBotInstance>).mockImplementation(() => mockBot());
});

// ── /hub/join ──────────────────────────────────────────────────────────────────

describe('POST /hub/join', () => {
    it('returns 401 without auth', async () => {
        await request(app).post('/hub/join').send({ hubId: 'h1' }).expect(401);
    });

    it('returns 401 for refresh tokens', async () => {
        await request(app).post('/hub/join')
            .set('Authorization', `Bearer ${createRefreshJwt()}`)
            .send({ hubId: 'h1' })
            .expect(401);
    });

    it('returns 400 when hubId missing', async () => {
        await request(app).post('/hub/join')
            .set('Authorization', authHeader())
            .send({})
            .expect(400);
    });

    it('joins hub successfully', async () => {
        (HubHandler.joinHub as jest.Mock).mockResolvedValue(undefined);
        await request(app).post('/hub/join')
            .set('Authorization', authHeader())
            .send({ hubId: 'h1' })
            .expect(200, { ok: true });
    });

    it('returns 403 when hub rejects join', async () => {
        (HubHandler.joinHub as jest.Mock).mockRejectedValue(new Error('forbidden'));
        await request(app).post('/hub/join')
            .set('Authorization', authHeader())
            .send({ hubId: 'h1' })
            .expect(403);
    });

    it('returns 400 when hubId exceeds max length', async () => {
        await request(app).post('/hub/join')
            .set('Authorization', authHeader())
            .send({ hubId: 'a'.repeat(129) })
            .expect(400);
    });
});

// ── /join ──────────────────────────────────────────────────────────────────────

describe('POST /join', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).post('/join')
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(401);
    });

    it('returns 400 when roomId missing', async () => {
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ url: 'https://youtube.com/watch?v=abc' })
            .expect(400);
    });

    it('returns 400 when url missing', async () => {
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(400);
    });

    it('returns 400 for disallowed domain', async () => {
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://evil.com/video' })
            .expect(400);
    });

    it('returns 403 when hub access denied', async () => {
        mockRoomAccess([]);
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(403);
    });

    it('returns 409 when bot already in room', async () => {
        bots.set('r1', mockBot());
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(409);
    });

    it('starts BotInstance and returns ok (audio mode)', async () => {
        const res = await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(200);
        expect(res.body.ok).toBe(true);
        expect(BotInstance).toHaveBeenCalled();
        expect(AVBotInstance).not.toHaveBeenCalled();
        expect(bots.has('r1')).toBe(true);
    });

    it('starts AVBotInstance and returns ok (video mode)', async () => {
        const res = await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc', videoMode: true })
            .expect(200);
        expect(res.body.ok).toBe(true);
        expect(AVBotInstance).toHaveBeenCalled();
        expect(BotInstance).not.toHaveBeenCalled();
        expect(bots.has('r1')).toBe(true);
    });

    it('cleans up bot on start failure', async () => {
        (BotInstance as jest.MockedClass<typeof BotInstance>).mockImplementation(
            () => mockBot({ start: jest.fn().mockRejectedValue(new Error('boom')) })
        );
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(500);
        expect(bots.has('r1')).toBe(false);
    });

    it('returns 400 when roomId exceeds max length', async () => {
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'a'.repeat(129), url: 'https://youtube.com/watch?v=abc' })
            .expect(400);
    });

    it('returns 400 when url exceeds max length', async () => {
        await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/' + 'a'.repeat(2048) })
            .expect(400);
    });

    it('ignores truthy non-boolean videoMode and treats it as false', async () => {
        const res = await request(app).post('/join')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc', videoMode: 'yes' })
            .expect(200);
        expect(res.body.videoMode).toBe(false);
        expect(BotInstance).toHaveBeenCalled();
        expect(AVBotInstance).not.toHaveBeenCalled();
    });
});

// ── /play ──────────────────────────────────────────────────────────────────────

describe('POST /play', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('calls changeTrack when bot already in room', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        const res = await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(200);
        expect(bot.changeTrack).toHaveBeenCalledWith('https://youtube.com/watch?v=abc');
        expect(res.body.action).toBe('changeTrack');
    });

    it('starts new BotInstance when none in room (audio mode)', async () => {
        const res = await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(200);
        expect(res.body.action).toBe('join');
        expect(BotInstance).toHaveBeenCalled();
        expect(AVBotInstance).not.toHaveBeenCalled();
        expect(bots.has('r1')).toBe(true);
    });

    it('starts new AVBotInstance when none in room (video mode)', async () => {
        const res = await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc', videoMode: true })
            .expect(200);
        expect(res.body.action).toBe('join');
        expect(AVBotInstance).toHaveBeenCalled();
        expect(BotInstance).not.toHaveBeenCalled();
        expect(bots.has('r1')).toBe(true);
    });

    it('returns 400 for disallowed domain', async () => {
        await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://evil.com/video' })
            .expect(400);
    });

    it('cleans up bot on start failure', async () => {
        (BotInstance as jest.MockedClass<typeof BotInstance>).mockImplementation(
            () => mockBot({ start: jest.fn().mockRejectedValue(new Error('boom')) })
        );
        await request(app).post('/play')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', url: 'https://youtube.com/watch?v=abc' })
            .expect(500);
        expect(bots.has('r1')).toBe(false);
    });
});

// ── /leave ─────────────────────────────────────────────────────────────────────

describe('POST /leave', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).post('/leave').send({ roomId: 'r1' }).expect(401);
    });

    it('returns 400 when roomId missing', async () => {
        await request(app).post('/leave')
            .set('Authorization', authHeader())
            .send({})
            .expect(400);
    });

    it('returns 404 when no bot in room', async () => {
        await request(app).post('/leave')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(404);
    });

    it('returns 403 when caller is not a room member', async () => {
        mockRoomAccess([]);
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/leave')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(403);
        expect(bot.destroy).not.toHaveBeenCalled();
    });

    it('destroys bot and removes from map', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/leave')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);
        expect(bot.destroy).toHaveBeenCalled();
        expect(bots.has('r1')).toBe(false);
    });
});

// ── /pause ─────────────────────────────────────────────────────────────────────

describe('POST /pause', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).post('/pause').send({ roomId: 'r1' }).expect(401);
    });

    it('returns 400 when roomId missing', async () => {
        await request(app).post('/pause')
            .set('Authorization', authHeader())
            .send({})
            .expect(400);
    });

    it('returns 404 when no bot in room', async () => {
        await request(app).post('/pause')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(404);
    });

    it('returns 403 when caller is not a room member', async () => {
        mockRoomAccess([]);
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/pause')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(403);
        expect(bot.pause).not.toHaveBeenCalled();
    });

    it('calls pause on bot', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/pause')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);
        expect(bot.pause).toHaveBeenCalled();
    });
});

// ── /resume ────────────────────────────────────────────────────────────────────

describe('POST /resume', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).post('/resume').send({ roomId: 'r1' }).expect(401);
    });

    it('returns 400 when roomId missing', async () => {
        await request(app).post('/resume')
            .set('Authorization', authHeader())
            .send({})
            .expect(400);
    });

    it('returns 404 when no bot in room', async () => {
        await request(app).post('/resume')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(404);
    });

    it('returns 403 when caller is not a room member', async () => {
        mockRoomAccess([]);
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/resume')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(403);
        expect(bot.resume).not.toHaveBeenCalled();
    });

    it('calls resume on bot', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/resume')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(200);
        expect(bot.resume).toHaveBeenCalled();
    });
});

// ── /seek ──────────────────────────────────────────────────────────────────────

describe('POST /seek', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).post('/seek').send({ roomId: 'r1', seconds: 10 }).expect(401);
    });

    it('returns 400 when roomId missing', async () => {
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ seconds: 10 })
            .expect(400);
    });

    it('returns 400 when seconds missing', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1' })
            .expect(400);
    });

    it('returns 404 when no bot in room', async () => {
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: 10 })
            .expect(404);
    });

    it('returns 403 when caller is not a room member', async () => {
        mockRoomAccess([]);
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: 10 })
            .expect(403);
        expect(bot.seek).not.toHaveBeenCalled();
    });

    it('calls seek with ms conversion', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: 30 })
            .expect(200);
        expect(bot.seek).toHaveBeenCalledWith(30_000);
    });

    it('clamps negative seconds to 0', async () => {
        const bot = mockBot();
        bots.set('r1', bot);
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: -10 })
            .expect(200);
        expect(bot.seek).toHaveBeenCalledWith(0);
    });

    it('returns 400 when seconds is a string', async () => {
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: 'thirty' })
            .expect(400);
    });

    it('returns 400 when seconds is Infinity', async () => {
        await request(app).post('/seek')
            .set('Authorization', authHeader())
            .send({ roomId: 'r1', seconds: Infinity })
            .expect(400);
    });
});

// ── /resolve ───────────────────────────────────────────────────────────────────

describe('POST /resolve', () => {
    it('returns 401 without auth', async () => {
        await request(app).post('/resolve')
            .send({ url: 'https://youtube.com/watch?v=abc' })
            .expect(401);
    });

    it('returns 400 when url missing', async () => {
        await request(app).post('/resolve')
            .set('Authorization', authHeader())
            .send({})
            .expect(400);
    });

    it('returns 400 for disallowed domain', async () => {
        await request(app).post('/resolve')
            .set('Authorization', authHeader())
            .send({ url: 'https://evil.com/track' })
            .expect(400);
    });

    it('returns 400 when url exceeds max length', async () => {
        await request(app).post('/resolve')
            .set('Authorization', authHeader())
            .send({ url: 'https://youtube.com/' + 'a'.repeat(2048) })
            .expect(400);
    });
});

// ── /rooms ─────────────────────────────────────────────────────────────────────

describe('GET /rooms', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).get('/rooms').expect(401);
    });

    it('returns only rooms accessible to the caller', async () => {
        bots.set('r1', mockBot());
        bots.set('r2', mockBot());
        const res = await request(app).get('/rooms')
            .set('Authorization', authHeader())
            .expect(200);
        expect(res.body.rooms).toEqual(['r1']);
    });

    it('returns empty list when no bots active', async () => {
        const res = await request(app).get('/rooms')
            .set('Authorization', authHeader())
            .expect(200);
        expect(res.body.rooms).toEqual([]);
    });
});

// ── /status/:roomId ────────────────────────────────────────────────────────────

describe('GET /status/:roomId', () => {
    beforeEach(() => {
        mockRoomAccess(['r1']);
    });

    it('returns 401 without auth', async () => {
        await request(app).get('/status/r1').expect(401);
    });

    it('returns 403 when caller is not a room member', async () => {
        mockRoomAccess([]);
        bots.set('r1', mockBot());
        await request(app).get('/status/r1')
            .set('Authorization', authHeader())
            .expect(403);
    });

    it('returns 404 when no bot in room', async () => {
        await request(app).get('/status/r1')
            .set('Authorization', authHeader())
            .expect(404);
    });

    it('returns bot status', async () => {
        bots.set('r1', mockBot());
        const res = await request(app).get('/status/r1')
            .set('Authorization', authHeader())
            .expect(200);
        expect(res.body).toEqual({ playing: true });
    });
});
