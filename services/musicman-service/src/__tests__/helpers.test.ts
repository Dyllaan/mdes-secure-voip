import { createHmac } from 'crypto';

import { extractUserId, checkUserRateLimit, secondsToTimestamp, isAllowedUrl } from '../http/Routes';

function makeJwt(sub: string, exp?: number): string {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        sub,
        exp: exp ?? Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const secret = Buffer.from('test-secret');
    const sig    = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
}

// ── extractUserId ──────────────────────────────────────────────────────────────

describe('extractUserId', () => {
    it('returns anonymous for undefined header', () => {
        expect(extractUserId(undefined)).toBe('anonymous');
    });

    it('returns anonymous for malformed header', () => {
        expect(extractUserId('NotBearer token')).toBe('anonymous');
    });

    it('returns anonymous for token with wrong number of parts', () => {
        expect(extractUserId('Bearer only.two')).toBe('anonymous');
    });

    it('returns anonymous for invalid signature', () => {
        const header  = Buffer.from('{}').toString('base64url');
        const payload = Buffer.from(JSON.stringify({ sub: 'user', exp: 9999999999 })).toString('base64url');
        expect(extractUserId(`Bearer ${header}.${payload}.badsig`)).toBe('anonymous');
    });

    it('returns anonymous for expired token', () => {
        const jwt = makeJwt('user-1', Math.floor(Date.now() / 1000) - 10);
        expect(extractUserId(`Bearer ${jwt}`)).toBe('anonymous');
    });

    it('returns sub for valid token', () => {
        const jwt = makeJwt('user-42');
        expect(extractUserId(`Bearer ${jwt}`)).toBe('user-42');
    });
});

// ── isAllowedUrl ───────────────────────────────────────────────────────────────

describe('isAllowedUrl', () => {
    it.each([
        'https://youtube.com/watch?v=abc',
        'https://www.youtube.com/watch?v=abc',
        'https://youtu.be/abc',
        'https://soundcloud.com/artist/track',
        'https://m.soundcloud.com/artist/track',
    ])('allows %s', (url) => {
        expect(isAllowedUrl(url)).toBe(true);
    });

    it.each([
        'https://evil.com/video',
        'https://notyoutube.com/watch?v=abc',
        'https://youtube.com.evil.com/watch?v=abc',
        'not-a-url',
        '',
    ])('blocks %s', (url) => {
        expect(isAllowedUrl(url)).toBe(false);
    });
});

// ── secondsToTimestamp ─────────────────────────────────────────────────────────

describe('secondsToTimestamp', () => {
    it.each([
        [0,    '0:00'],
        [59,   '0:59'],
        [60,   '1:00'],
        [90,   '1:30'],
        [3599, '59:59'],
        [3600, '1:00:00'],
        [3661, '1:01:01'],
        [7322, '2:02:02'],
    ])('converts %ds to %s', (input, expected) => {
        expect(secondsToTimestamp(input)).toBe(expected);
    });
});

// ── checkUserRateLimit ─────────────────────────────────────────────────────────

describe('checkUserRateLimit', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('allows up to 5 requests within the window', () => {
        const uid = `test-user-${Math.random()}`;
        for (let i = 0; i < 5; i++) {
            expect(checkUserRateLimit(uid)).toBe(true);
        }
    });

    it('blocks the 6th request within the window', () => {
        const uid = `test-user-${Math.random()}`;
        for (let i = 0; i < 5; i++) checkUserRateLimit(uid);
        expect(checkUserRateLimit(uid)).toBe(false);
    });

    it('resets count after the window expires', () => {
        const uid = `test-user-${Math.random()}`;
        for (let i = 0; i < 5; i++) checkUserRateLimit(uid);
        jest.advanceTimersByTime(61_000);
        expect(checkUserRateLimit(uid)).toBe(true);
    });
});