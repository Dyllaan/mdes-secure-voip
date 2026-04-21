jest.mock('child_process', () => require('../__mocks__/child_process'));

import { AudioPipeline, OPUS_FRAME_MS } from '../pipelines/AudioPipeline';
import { spawn, createMockProcess } from '../__mocks__/child_process';

const realSetImmediate = jest.requireActual<typeof import('timers')>('timers').setImmediate;
const tick = () => new Promise<void>((r) => realSetImmediate(r));

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

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (spawn as jest.Mock).mockImplementation(() => createMockProcess());
});

afterEach(() => {
    jest.useRealTimers();
});

function buildOggPage(opts: { bos?: boolean; packets: Buffer[] }): Buffer {
    const { bos = false, packets } = opts;
    const body: Buffer[] = [];
    const segTable: number[] = [];

    for (const pkt of packets) {
        let remaining = pkt.length;
        let off = 0;
        while (remaining > 0) {
            const seg = Math.min(255, remaining);
            segTable.push(seg);
            body.push(pkt.subarray(off, off + seg));
            remaining -= seg;
            off += seg;
        }
    }

    const numSegments = segTable.length;
    const headerSize = 27 + numSegments;
    const bodyBuf = Buffer.concat(body);
    const page = Buffer.alloc(headerSize + bodyBuf.length);

    page.write('OggS', 0, 'ascii');
    page[4] = 0;
    page[5] = bos ? 0x02 : 0x00;
    page[26] = numSegments;
    for (let i = 0; i < numSegments; i++) page[27 + i] = segTable[i];
    bodyBuf.copy(page, headerSize);
    return page;
}

describe('AudioPipeline', () => {
    describe('start()', () => {
        it('should spawn yt-dlp and ffmpeg processes', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            expect(spawn).toHaveBeenCalledTimes(2);
            const calls = (spawn as jest.Mock).mock.calls;
            expect(calls[0][0]).toBe('yt-dlp');
            expect(calls[1][0]).toBe('ffmpeg');
            pipeline.stop();
        });

        it('should direct yt-dlp temp fragment files into /tmp', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            const ytdlpArgs = (spawn as jest.Mock).mock.calls[0][1] as string[];
            expect(ytdlpArgs).toContain('--paths');
            expect(ytdlpArgs).toContain('temp:/tmp');
            pipeline.stop();
        });

        it('should set running=true after start', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            expect(pipeline.running).toBe(true);
            pipeline.stop();
        });

        it('should be idempotent - second start() does nothing', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.start();
            expect(spawn).toHaveBeenCalledTimes(2);
            pipeline.stop();
        });

        it('should pass -ss flag to ffmpeg when seekMs > 0', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start(5000);
            const ffmpegArgs = (spawn as jest.Mock).mock.calls[1][1] as string[];
            expect(ffmpegArgs).toContain('-ss');
            expect(ffmpegArgs).toContain('5');
            pipeline.stop();
        });

        it('should NOT pass -ss to ffmpeg when seekMs is 0', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start(0);
            const ffmpegArgs = (spawn as jest.Mock).mock.calls[1][1] as string[];
            expect(ffmpegArgs).not.toContain('-ss');
            pipeline.stop();
        });
    });

    describe('pause() and resume()', () => {
        it('should set isPaused=true when running', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.pause();
            expect(pipeline.isPaused).toBe(true);
            pipeline.stop();
        });

        it('should not set isPaused when not running', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.pause();
            expect(pipeline.isPaused).toBe(false);
        });

        it('should set isPaused=false when resumed', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.pause();
            pipeline.resume();
            expect(pipeline.isPaused).toBe(false);
            pipeline.stop();
        });

        it('should NOT emit frame events while paused', () => {
            const mockProc = createMockProcess();
            (spawn as jest.Mock).mockReturnValue(mockProc);
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const frameSpy = jest.fn();
            pipeline.on('frame', frameSpy);
            pipeline.start();
            pipeline.pause();
            pipeline['queue'].push(Buffer.from('some-opus-data'));
            jest.advanceTimersByTime(OPUS_FRAME_MS * 3);
            expect(frameSpy).not.toHaveBeenCalled();
            pipeline.stop();
        });

        it('should emit frame events after resume', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const frameSpy = jest.fn();
            pipeline.on('frame', frameSpy);
            pipeline.start();
            pipeline.pause();
            pipeline['queue'].push(Buffer.from('opus-data'));
            pipeline.resume();
            jest.advanceTimersByTime(OPUS_FRAME_MS);
            expect(frameSpy).toHaveBeenCalledTimes(1);
            pipeline.stop();
        });
    });

    describe('positionMs getter', () => {
        it('should return seekOffsetMs + frameCount * OPUS_FRAME_MS', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start(1000);
            pipeline['queue'].push(Buffer.from('frame1'));
            pipeline['queue'].push(Buffer.from('frame2'));
            jest.advanceTimersByTime(OPUS_FRAME_MS * 2);
            expect(pipeline.positionMs).toBe(1000 + 2 * OPUS_FRAME_MS);
            pipeline.stop();
        });
    });

    describe('stop()', () => {
        it('should set running=false', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.stop();
            expect(pipeline.running).toBe(false);
        });

        it('should be idempotent (safe to call when not running)', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            expect(() => pipeline.stop()).not.toThrow();
        });

        it('should kill yt-dlp with SIGTERM', () => {
            const mockYtdlp = createMockProcess();
            const mockFfmpeg = createMockProcess();
            (spawn as jest.Mock).mockReturnValueOnce(mockYtdlp).mockReturnValueOnce(mockFfmpeg);
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.stop();
            expect(mockYtdlp.kill).toHaveBeenCalledWith('SIGTERM');
        });

        it('should kill ffmpeg with SIGTERM', () => {
            const mockYtdlp = createMockProcess();
            const mockFfmpeg = createMockProcess();
            (spawn as jest.Mock).mockReturnValueOnce(mockYtdlp).mockReturnValueOnce(mockFfmpeg);
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.stop();
            expect(mockFfmpeg.kill).toHaveBeenCalledWith('SIGTERM');
        });
    });

    describe('seek(ms)', () => {
        it('should stop then start with the new offset', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            expect(spawn).toHaveBeenCalledTimes(2);
            pipeline.seek(30000);
            expect(spawn).toHaveBeenCalledTimes(4);
            const ffmpegArgs = (spawn as jest.Mock).mock.calls[3][1] as string[];
            expect(ffmpegArgs).toContain('-ss');
            expect(ffmpegArgs).toContain('30');
            pipeline.stop();
        });

        it('should clamp negative seek to 0 (no -ss)', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();
            pipeline.seek(-5000);
            const ffmpegArgs = (spawn as jest.Mock).mock.calls[3][1] as string[];
            expect(ffmpegArgs).not.toContain('-ss');
            pipeline.stop();
        });
    });

    describe('frame emission from OGG data', () => {
        it('should emit frame events when queue has data', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const frameSpy = jest.fn();
            pipeline.on('frame', frameSpy);
            pipeline.start();
            pipeline['queue'].push(Buffer.from('opus-packet-1'));
            pipeline['queue'].push(Buffer.from('opus-packet-2'));
            jest.advanceTimersByTime(OPUS_FRAME_MS * 2);
            expect(frameSpy).toHaveBeenCalledTimes(2);
            pipeline.stop();
        });

        it('should emit frame with correct structure', () => {
            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const frames: any[] = [];
            pipeline.on('frame', (f) => frames.push(f));
            pipeline.start();
            pipeline['queue'].push(Buffer.from('opus-data'));
            jest.advanceTimersByTime(OPUS_FRAME_MS);
            expect(frames[0]).toMatchObject({ data: expect.any(Buffer), durationMs: OPUS_FRAME_MS });
            pipeline.stop();
        });
    });

    describe('extractOggPackets (via ffmpeg stdout data event)', () => {
        it('should parse a valid OGG page and emit a frame packet via queue', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();

            mockProcs[1].stdout.push(buildOggPage({ packets: [Buffer.from('opusaudiodata12345678')] }));
            await tick();

            expect(pipeline['queue']).toHaveLength(1);
            pipeline.stop();
        });

        it('should skip BOS (beginning of stream) pages', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();

            mockProcs[1].stdout.push(buildOggPage({ bos: true, packets: [Buffer.from('head')] }));
            await tick();

            expect(pipeline['queue']).toHaveLength(0);
            pipeline.stop();
        });

        it('should skip OpusHead packets', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();

            const opusHead = Buffer.from('OpusHead\x01\x02\x00\x38\x80\xBB\x00\x00\x00\x00\x00');
            mockProcs[1].stdout.push(buildOggPage({ packets: [opusHead] }));
            await tick();

            expect(pipeline['queue']).toHaveLength(0);
            pipeline.stop();
        });

        it('should resync to next OggS magic after garbage prefix', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();

            const validPage = buildOggPage({ packets: [Buffer.from('opusaudiodata12345678')] });
            mockProcs[1].stdout.push(Buffer.concat([Buffer.from('GARBAGE_DATA_NOT_OGG'), validPage]));
            await tick();

            expect(pipeline['queue']).toHaveLength(1);
            pipeline.stop();
        });

        it('should hold incomplete page data in buffer until next chunk', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            pipeline.start();

            const fullPage = buildOggPage({ packets: [Buffer.from('opusaudiodata12345678')] });
            const half = Math.floor(fullPage.length / 2);

            mockProcs[1].stdout.push(fullPage.subarray(0, half));
            await tick();
            expect(pipeline['queue']).toHaveLength(0);

            mockProcs[1].stdout.push(fullPage.subarray(half));
            await tick();
            expect(pipeline['queue']).toHaveLength(1);
            pipeline.stop();
        });
    });

    describe('"ended" event', () => {
        it('should emit "ended" after ffmpeg closes and queue drains', () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const endedSpy = jest.fn();
            pipeline.on('ended', endedSpy);
            pipeline.start();

            mockProcs[1].emit('close', 0);
            jest.advanceTimersByTime(OPUS_FRAME_MS * 2);
            expect(endedSpy).toHaveBeenCalledWith(0);
        });

        it('emits "ended" only once for a single run', () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const endedSpy = jest.fn();
            pipeline.on('ended', endedSpy);
            pipeline.start();

            mockProcs[1].emit('close', 0);
            jest.advanceTimersByTime(OPUS_FRAME_MS * 4);
            mockProcs[1].emit('close', 0);
            jest.advanceTimersByTime(OPUS_FRAME_MS * 4);

            expect(endedSpy).toHaveBeenCalledTimes(1);
            expect(endedSpy).toHaveBeenCalledWith(0);
        });

        it('can resume buffered audio after ffmpeg closes while paused', () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const frameSpy = jest.fn();
            pipeline.on('frame', frameSpy);
            pipeline.start();

            pipeline.pause();
            pipeline['queue'].push(Buffer.from('buffered-frame'));
            mockProcs[1].emit('close', 0);

            expect(pipeline.running).toBe(true);
            pipeline.resume();
            jest.advanceTimersByTime(OPUS_FRAME_MS);

            expect(frameSpy).toHaveBeenCalledTimes(1);
        });

        it('ignores stale close events from a previous run after seek restarts the pipeline', () => {
            const mockProcs = [
                createMockProcess(), createMockProcess(),
                createMockProcess(), createMockProcess(),
            ];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test');
            const endedSpy = jest.fn();
            pipeline.on('ended', endedSpy);
            pipeline.start();

            pipeline.seek(30_000);
            mockProcs[1].emit('close', 0);
            jest.advanceTimersByTime(OPUS_FRAME_MS * 4);

            expect(endedSpy).not.toHaveBeenCalled();
            expect(pipeline.running).toBe(true);
        });
    });

    describe('diagnostic logging', () => {
        it('logs summarized yt-dlp failures with stderr context', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);
            const logCapture = captureStderrLogs();

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test', 'test-room');
            pipeline.on('error', () => {});
            pipeline.start();

            mockProcs[0].stderr.push('unsupported url\n');
            await tick();
            mockProcs[0].emit('exit', 1, null);

            const entry = logCapture.entries().find((log) => log.message === 'ytdlp.exit.unexpected');
            expect(entry).toMatchObject({
                context: 'audioPipeline',
                logContext: 'test-room',
                code: 1,
                stderrSummary: expect.stringContaining('unsupported url'),
            });

            logCapture.spy.mockRestore();
            pipeline.stop();
        });

        it('logs summarized ffmpeg failures with stderr context', async () => {
            const mockProcs = [createMockProcess(), createMockProcess()];
            let procIdx = 0;
            (spawn as jest.Mock).mockImplementation(() => mockProcs[procIdx++]);
            const logCapture = captureStderrLogs();

            const pipeline = new AudioPipeline('https://www.youtube.com/watch?v=test', 'test-room');
            pipeline.on('error', () => {});
            pipeline.start();

            mockProcs[1].stderr.push('Invalid data found when processing input\n');
            await tick();
            mockProcs[1].emit('close', 1);

            const entry = logCapture.entries().find((log) => log.message === 'ffmpeg.close.unexpected');
            expect(entry).toMatchObject({
                context: 'audioPipeline',
                logContext: 'test-room',
                code: 1,
                stderrSummary: expect.stringContaining('Invalid data found when processing input'),
            });

            logCapture.spy.mockRestore();
            pipeline.stop();
        });
    });
});
