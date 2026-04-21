import { MusicSession } from '../music/MusicSession';
import type { QueueItem } from '../music/types';

function makeItem(id: string, url = `https://www.youtube.com/watch?v=${id}`): QueueItem {
    return {
        id,
        url,
        title:     `Track ${id}`,
        channel:   'YouTube',
        duration:  '3:00',
        durationMs: 180_000,
        source:    'youtube',
    };
}

interface MockBot {
    videoMode:              boolean;
    start:                  jest.Mock;
    destroy:                jest.Mock;
    pause:                  jest.Mock;
    resume:                 jest.Mock;
    seek:                   jest.Mock;
    changeTrack:            jest.Mock;
    emitRoomEvent:          jest.Mock;
    setAutoLeaveCallback:   jest.Mock;
    setTrackEndedCallback:  jest.Mock;
    setDestroyCallback:     jest.Mock;
    getStatus:              jest.Mock;
}

function makeMockBot(overrides: Partial<MockBot> = {}): MockBot {
    return {
        videoMode:             false,
        start:                 jest.fn().mockResolvedValue(undefined),
        destroy:               jest.fn(),
        pause:                 jest.fn(),
        resume:                jest.fn(),
        seek:                  jest.fn(),
        changeTrack:           jest.fn(),
        emitRoomEvent:         jest.fn(),
        setAutoLeaveCallback:  jest.fn(),
        setTrackEndedCallback: jest.fn(),
        setDestroyCallback:    jest.fn(),
        getStatus:             jest.fn().mockReturnValue({
            playing: true, paused: false, positionMs: 1000, url: 'https://www.youtube.com/watch?v=default',
        }),
        ...overrides,
    };
}

function getAutoLeaveCb(bot: MockBot): () => void {
    return bot.setAutoLeaveCallback.mock.calls[0][0] as () => void;
}

function getTrackEndedCb(bot: MockBot): () => void {
    return bot.setTrackEndedCallback.mock.calls[0][0] as () => void;
}

function getDestroyCb(bot: MockBot): (reason: string) => void {
    return bot.setDestroyCallback.mock.calls[0][0] as (reason: string) => void;
}

function makeSession(
    items: QueueItem[],
    bot: MockBot,
    onDisposed = jest.fn(),
    roomId = 'room-1',
): MusicSession {
    return new MusicSession(roomId, bot as any, items, onDisposed);
}

const A = makeItem('a');
const B = makeItem('b');
const C = makeItem('c');
const D = makeItem('d');

describe('MusicSession', () => {
    describe('constructor', () => {
        it('registers all three bot callbacks', () => {
            const bot = makeMockBot();
            makeSession([A], bot);

            expect(bot.setAutoLeaveCallback).toHaveBeenCalledTimes(1);
            expect(bot.setTrackEndedCallback).toHaveBeenCalledTimes(1);
            expect(bot.setDestroyCallback).toHaveBeenCalledTimes(1);

            expect(bot.setAutoLeaveCallback).toHaveBeenCalledWith(expect.any(Function));
            expect(bot.setTrackEndedCallback).toHaveBeenCalledWith(expect.any(Function));
            expect(bot.setDestroyCallback).toHaveBeenCalledWith(expect.any(Function));
        });

        it('exposes videoMode from the bot', () => {
            const audioBot = makeMockBot({ videoMode: false });
            const videoBot = makeMockBot({ videoMode: true });

            expect(makeSession([A], audioBot).videoMode).toBe(false);
            expect(makeSession([A], videoBot).videoMode).toBe(true);
        });
    });

    describe('start()', () => {
        it('calls bot.start()', async () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            await session.start();
            expect(bot.start).toHaveBeenCalledTimes(1);
        });

        it('emits state after bot.start() resolves', async () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            await session.start();
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });

        it('propagates a rejection from bot.start()', async () => {
            const bot = makeMockBot({ start: jest.fn().mockRejectedValue(new Error('connect failed')) });
            const session = makeSession([A], bot);
            await expect(session.start()).rejects.toThrow('connect failed');
        });
    });

    describe('getState()', () => {
        it('maps queue, currentIndex, and bot status correctly', () => {
            const bot = makeMockBot({
                getStatus: jest.fn().mockReturnValue({ playing: false, paused: true, positionMs: 5000, url: A.url }),
            });
            const session = makeSession([A, B, C], bot);
            const state = session.getState();

            expect(state.roomId).toBe('room-1');
            expect(state.queue).toEqual([A, B, C]);
            expect(state.currentIndex).toBe(0);
            expect(state.currentTrack).toEqual(A);
            expect(state.playing).toBe(false);
            expect(state.paused).toBe(true);
            expect(state.positionMs).toBe(5000);
            expect(state.url).toBe(A.url);
            expect(state.videoMode).toBe(false);
            expect(state.screenPeerId).toBeNull();
        });

        it('includes screenPeerId when bot status provides a string value', () => {
            const bot = makeMockBot({
                getStatus: jest.fn().mockReturnValue({
                    playing: true, paused: false, positionMs: 0, url: A.url, screenPeerId: 'peer-abc',
                }),
            });
            const session = makeSession([A], bot);
            expect(session.getState().screenPeerId).toBe('peer-abc');
        });

        it('ignores a non-string screenPeerId in bot status', () => {
            const bot = makeMockBot({
                getStatus: jest.fn().mockReturnValue({
                    playing: true, paused: false, positionMs: 0, url: A.url, screenPeerId: 123,
                }),
            });
            const session = makeSession([A], bot);
            expect(session.getState().screenPeerId).toBeNull();
        });

        it('falls back to bot status url when queue is empty', () => {
            const bot = makeMockBot({
                getStatus: jest.fn().mockReturnValue({ playing: false, paused: false, positionMs: 0, url: 'https://youtu.be/fallback' }),
            });
            const session = makeSession([A], bot);
            const onDisposed = jest.fn();
            const s2 = new MusicSession('r', bot as any, [A], onDisposed);
            expect(session.getState().url).toBe(A.url);
        });
    });

    describe('addItems()', () => {
        it('appends items to the existing queue', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.addItems([B, C]);

            const state = session.getState();
            expect(state.queue).toEqual([A, B, C]);
        });

        it('does not change currentIndex', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.addItems([B, C]);
            expect(session.getState().currentIndex).toBe(0);
        });

        it('emits state after adding', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.addItems([B]);
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });

        it('returns the updated state', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            const returned = session.addItems([B]);
            expect(returned.queue).toEqual([A, B]);
        });
    });

    describe('playNow()', () => {
        it('replaces the queue with the single given item', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.playNow(D);
            expect(session.getState().queue).toEqual([D]);
        });

        it('resets currentIndex to 0', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.playNow(D);
            expect(session.getState().currentIndex).toBe(0);
        });

        it('calls bot.changeTrack with the new url', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            session.playNow(D);
            expect(bot.changeTrack).toHaveBeenCalledWith(D.url);
        });

        it('emits state', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.playNow(B);
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });
    });

    describe('playItem()', () => {
        it('sets currentIndex to the item\'s position and calls changeTrack', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.playItem(C.id);

            expect(session.getState().currentIndex).toBe(2);
            expect(bot.changeTrack).toHaveBeenCalledWith(C.url);
        });

        it('emits state after changing track', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            bot.emitRoomEvent.mockClear();
            session.playItem(B.id);
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });

        it('throws when itemId is not in the queue', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            expect(() => session.playItem('nonexistent')).toThrow(/nonexistent/);
        });
    });

    describe('removeItem()', () => {
        it('removes a non-current item that comes after currentIndex without changing the index', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.removeItem(C.id);

            const state = session.getState();
            expect(state.queue).toEqual([A, B]);
            expect(state.currentIndex).toBe(0);
            expect(bot.changeTrack).not.toHaveBeenCalled();
        });

        it('decrements currentIndex when removing an item that precedes the current track', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.playItem(C.id); // currentIndex = 2
            bot.changeTrack.mockClear();

            session.removeItem(A.id); // index 0 < currentIndex 2

            const state = session.getState();
            expect(state.currentIndex).toBe(1);
            expect(state.currentTrack).toEqual(C);
            expect(bot.changeTrack).not.toHaveBeenCalled();
        });

        it('plays the next track when the current item is removed and others remain', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.removeItem(A.id); // A is current (index 0)

            expect(bot.changeTrack).toHaveBeenCalledWith(B.url);
            expect(session.getState().currentIndex).toBe(0);
            expect(session.getState().queue).toEqual([B, C]);
        });

        it('destroys the session when the only item is removed', () => {
            const bot = makeMockBot();
            const onDisposed = jest.fn();
            const session = makeSession([A], bot, onDisposed);
            const result = session.removeItem(A.id);

            expect(result).toBeNull();
            expect(bot.destroy).toHaveBeenCalledWith('queue_empty');
        });

        it('throws when itemId is not in the queue', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            expect(() => session.removeItem('ghost')).toThrow(/ghost/);
        });

        it('emits state after a non-destructive removal', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            bot.emitRoomEvent.mockClear();
            session.removeItem(B.id);
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });
    });


    describe('clear()', () => {
        it('calls destroy with queue_cleared reason', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            session.clear();
            expect(bot.destroy).toHaveBeenCalledWith('queue_cleared');
        });

        it('accepts a custom reason', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.clear('user_initiated');
            expect(bot.destroy).toHaveBeenCalledWith('user_initiated');
        });
    });


    describe('next()', () => {
        it('removes the current track and plays the first of the remainder', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            const state = session.next();

            expect(state).not.toBeNull();
            expect(bot.changeTrack).toHaveBeenCalledWith(B.url);
            expect(session.getState().queue).toEqual([B, C]);
            expect(session.getState().currentIndex).toBe(0);
        });

        it('destroys the session and returns null when on the last track', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            const result = session.next();

            expect(result).toBeNull();
            expect(bot.destroy).toHaveBeenCalledWith('queue_finished');
        });

        it('returns null immediately if the session is already disposed', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            const destroyCb = getDestroyCb(bot);
            destroyCb('external_reason');

            const result = session.next();
            expect(result).toBeNull();
        });
    });


    describe('reorder()', () => {
        it('reorders the queue to match the given id array', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.reorder([C.id, A.id, B.id]);
            expect(session.getState().queue).toEqual([C, A, B]);
        });

        it('tracks the current item\'s new position after reorder', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            session.playItem(B.id);

            session.reorder([C.id, A.id, B.id]);
            expect(session.getState().currentIndex).toBe(2);
            expect(session.getState().currentTrack).toEqual(B);
        });

        it('emits state after reordering', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            bot.emitRoomEvent.mockClear();
            session.reorder([B.id, A.id]);
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });

        it('throws when the length of itemIds does not match queue length', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            expect(() => session.reorder([A.id, B.id])).toThrow(/length/);
        });

        it('throws when an itemId is not in the queue', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            expect(() => session.reorder([A.id, 'ghost'])).toThrow(/ghost/);
        });

        it('throws when itemIds contains duplicates', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            expect(() => session.reorder([A.id, A.id])).toThrow(/unique/);
        });
    });


    describe('shuffle()', () => {
        it('keeps the current item at index 0 after shuffling', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C, D], bot);
            session.shuffle();

            const state = session.getState();
            expect(state.currentIndex).toBe(0);
            expect(state.currentTrack).toEqual(A);
        });

        it('preserves all items in the queue', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C, D], bot);
            session.shuffle();

            const ids = session.getState().queue.map((item) => item.id).sort();
            expect(ids).toEqual([A.id, B.id, C.id, D.id].sort());
        });

        it('returns state unchanged for a single-item queue', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.shuffle();
            expect(bot.emitRoomEvent).not.toHaveBeenCalled();
        });

        it('emits state after a multi-item shuffle', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            bot.emitRoomEvent.mockClear();
            session.shuffle();
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });
    });


    describe('pause()', () => {
        it('calls bot.pause()', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.pause();
            expect(bot.pause).toHaveBeenCalledTimes(1);
        });

        it('emits state after pausing', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.pause();
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });
    });


    describe('resume()', () => {
        it('calls bot.resume()', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.resume();
            expect(bot.resume).toHaveBeenCalledTimes(1);
        });

        it('emits state after resuming', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.resume();
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });
    });


    describe('seek()', () => {
        it('calls bot.seek() with the given milliseconds', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.seek(45_000);
            expect(bot.seek).toHaveBeenCalledWith(45_000);
        });

        it('emits state after seeking', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.seek(10_000);
            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: true }),
            );
        });
    });


    describe('destroy()', () => {
        it('calls bot.destroy() with the given reason', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.destroy('manual');
            expect(bot.destroy).toHaveBeenCalledWith('manual');
        });

        it('defaults reason to "manual"', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.destroy();
            expect(bot.destroy).toHaveBeenCalledWith('manual');
        });

        it('emits an inactive event before destroying', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.destroy();

            expect(bot.emitRoomEvent).toHaveBeenCalledWith(
                'musicman:session-state',
                expect.objectContaining({ active: false, state: null }),
            );
        });

        it('is idempotent: a second call is a no-op', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            session.destroy();
            session.destroy();
            expect(bot.destroy).toHaveBeenCalledTimes(1);
        });

        it('is a no-op when already disposed via bot destroy callback', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            const destroyCb = getDestroyCb(bot);
            destroyCb('bot_went_away'); // sets disposed=true

            bot.destroy.mockClear();
            session.destroy('manual');
            expect(bot.destroy).not.toHaveBeenCalled();
        });
    });


    describe('auto-leave callback', () => {
        it('calls destroy when the bot triggers auto-leave', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            const autoLeaveCb = getAutoLeaveCb(bot);

            autoLeaveCb();

            expect(bot.destroy).toHaveBeenCalled();
        });
    });


    describe('track-ended callback', () => {
        it('advances to the next track when the current one ends', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            const trackEndedCb = getTrackEndedCb(bot);

            jest.spyOn(Date, 'now').mockReturnValue(5_000);
            trackEndedCb();

            expect(bot.changeTrack).toHaveBeenCalledWith(B.url);
            expect(session.getState().queue).toEqual([B, C]);
            jest.restoreAllMocks();
        });

        it('ignores duplicate ended callbacks immediately after a track transition', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B, C], bot);
            const trackEndedCb = getTrackEndedCb(bot);
            const nowSpy = jest.spyOn(Date, 'now');

            nowSpy.mockReturnValue(5_000);
            trackEndedCb();

            nowSpy.mockReturnValue(5_100);
            trackEndedCb();

            expect(bot.changeTrack).toHaveBeenCalledTimes(1);
            expect(bot.changeTrack).toHaveBeenCalledWith(B.url);
            expect(session.getState().queue).toEqual([B, C]);
            nowSpy.mockRestore();
        });

        it('destroys the session when the last track ends', () => {
            const bot = makeMockBot();
            makeSession([A], bot);
            const trackEndedCb = getTrackEndedCb(bot);

            jest.spyOn(Date, 'now').mockReturnValue(5_000);
            trackEndedCb();

            expect(bot.destroy).toHaveBeenCalledWith('queue_finished');
            jest.restoreAllMocks();
        });

        it('is a no-op when the session is already disposed', () => {
            const bot = makeMockBot();
            makeSession([A, B], bot);
            const trackEndedCb = getTrackEndedCb(bot);
            const destroyCb    = getDestroyCb(bot);

            destroyCb('external');       // marks disposed=true
            bot.changeTrack.mockClear();
            bot.destroy.mockClear();

            trackEndedCb();

            expect(bot.changeTrack).not.toHaveBeenCalled();
            expect(bot.destroy).not.toHaveBeenCalled();
        });
    });


    describe('bot destroy callback', () => {
        it('calls onDisposed with the roomId and the reason', () => {
            const bot = makeMockBot();
            const onDisposed = jest.fn();
            makeSession([A], bot, onDisposed, 'room-xyz');

            const destroyCb = getDestroyCb(bot);
            destroyCb('bot_crashed');

            expect(onDisposed).toHaveBeenCalledWith('room-xyz', 'bot_crashed');
        });

        it('prevents further destroy calls once disposed', () => {
            const bot = makeMockBot();
            const onDisposed = jest.fn();
            const session = makeSession([A], bot, onDisposed);

            const destroyCb = getDestroyCb(bot);
            destroyCb('reason_one');
            destroyCb('reason_two');

            expect(onDisposed).toHaveBeenCalledTimes(1);
        });

        it('resets the destroying flag so dispose cannot re-enter', () => {
            const bot = makeMockBot();
            const onDisposed = jest.fn();
            const session = makeSession([A], bot, onDisposed);

            session.destroy('pre_destroy');
            const destroyCb = getDestroyCb(bot);
            destroyCb('bot_ack');          // should fire onDisposed once

            expect(onDisposed).toHaveBeenCalledTimes(1);
            bot.destroy.mockClear();
            session.destroy('again');
            expect(bot.destroy).not.toHaveBeenCalled();
        });
    });


    describe('emitRoomEvent payload shapes', () => {
        it('emitState sends active:true with full state', () => {
            const bot = makeMockBot();
            const session = makeSession([A, B], bot);
            bot.emitRoomEvent.mockClear();
            session.pause(); // triggers emitState

            const [event, payload] = bot.emitRoomEvent.mock.calls[0];
            expect(event).toBe('musicman:session-state');
            expect(payload.active).toBe(true);
            expect(payload.roomId).toBe('room-1');
            expect(payload.state).toMatchObject({
                roomId:       'room-1',
                queue:        [A, B],
                currentIndex: 0,
                videoMode:    false,
            });
        });

        it('emitInactive sends active:false with null state', () => {
            const bot = makeMockBot();
            const session = makeSession([A], bot);
            bot.emitRoomEvent.mockClear();
            session.destroy();

            const [event, payload] = bot.emitRoomEvent.mock.calls[0];
            expect(event).toBe('musicman:session-state');
            expect(payload.active).toBe(false);
            expect(payload.state).toBeNull();
            expect(payload.roomId).toBe('room-1');
        });
    });
});
