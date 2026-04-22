/**
 * AudioPipeline
 *
 * Spawns a yt-dlp | ffmpeg subprocess pipeline to extract Opus audio frames
 * from a URL, emitting 'frame' events at 20ms intervals and an 'ended' event
 * when the stream finishes. Supports pause/resume and seek.
 * ONLY USED WHEN VIDEO MODE IS DISABLED. In video mode, the AVPipeline class is used instead.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
    appendStderrLines,
    createLogger,
    summarizeStderrLines,
    truncateForLog,
    type Logger,
} from '../logging';

export const OPUS_FRAME_MS = 20;
export const SAMPLE_RATE = 48_000;
export const CHANNELS = 1;
export const RTP_TIMESTAMP_STEP = SAMPLE_RATE * OPUS_FRAME_MS / 1000;
const YTDLP_TEMP_DIR = (process.env.YTDLP_TEMP_DIR ?? '/tmp').trim() || '/tmp';

export interface OpusFrame {
    data: Buffer;
    durationMs: number;
}

function extractOggPackets(buf: Buffer, onPacket: (pkt: Buffer) => void): Buffer {
    let offset = 0;

    while (offset + 27 <= buf.length) {
        if (buf.toString('ascii', offset, offset + 4) !== 'OggS') {
            const next = buf.indexOf('OggS', offset + 1);
            if (next === -1) return buf.subarray(offset);
            offset = next;
            continue;
        }

        const headerType = buf[offset + 5];
        const numSegments = buf[offset + 26];
        if (offset + 27 + numSegments > buf.length) break;

        const segTable: number[] = [];
        for (let i = 0; i < numSegments; i++) {
            segTable.push(buf[offset + 27 + i]);
        }

        const bodySize = segTable.reduce((a, b) => a + b, 0);
        const pageSize = 27 + numSegments + bodySize;
        if (offset + pageSize > buf.length) break;

        const isBOS = (headerType & 0x02) !== 0;

        if (!isBOS) {
            let pktStart = offset + 27 + numSegments;
            let pktLen = 0;

            for (const seg of segTable) {
                pktLen += seg;
                if (seg < 255) {
                    const pkt = buf.subarray(pktStart, pktStart + pktLen);
                    const tag = pkt.toString('ascii', 0, Math.min(8, pkt.length));
                    if (!tag.startsWith('OpusHead') && !tag.startsWith('OpusTags')) {
                        onPacket(Buffer.from(pkt));
                    }
                    pktStart += pktLen;
                    pktLen = 0;
                }
            }
        }

        offset += pageSize;
    }

    return buf.subarray(offset);
}

export class AudioPipeline extends EventEmitter {
    private ytdlp: ChildProcess | null = null;
    private ffmpeg: ChildProcess | null = null;
    private buf: Buffer = Buffer.alloc(0);
    private timer: NodeJS.Timeout | null = null;
    private queue: Buffer[] = [];
    private _running = false;
    private _paused = false;
    private _frameCount = 0;
    private _seekOffsetMs = 0;
    private _drainCheck: NodeJS.Timeout | null = null;
    private ytdlpStderrLines: string[] = [];
    private ffmpegStderrLines: string[] = [];
    private failureEmitted = false;
    private endedRunId = -1;
    private runId = 0;
    private readonly logger: Logger;

    get running() { return this._running; }
    get isPaused() { return this._paused; }
    get positionMs() { return this._seekOffsetMs + this._frameCount * OPUS_FRAME_MS; }

    constructor(
        private readonly url: string,
        private readonly logContext = 'audio-pipeline',
    ) {
        super();
        this.logger = createLogger('audioPipeline', { logContext });
    }

    private get logPrefix(): string {
        return `[AudioPipeline ${this.logContext}]`;
    }

    private emitProcessFailure(
        processName: 'yt-dlp' | 'ffmpeg',
        details: { code?: number | null; signal?: NodeJS.Signals | null; stderrSummary: string | null },
    ): void {
        if (this.failureEmitted) return;
        this.failureEmitted = true;
        const summary = details.stderrSummary ?? 'no stderr captured';
        this.emit('error', new Error(
            `${this.logPrefix} ${processName} failed for ${truncateForLog(this.url) ?? 'unknown url'} `
            + `(code=${details.code ?? 'null'}, signal=${details.signal ?? 'null'}): ${summary}`,
        ));
    }

    start(seekMs = 0): void {
        if (this._running) return;
        const runId = ++this.runId;
        this._running = true;
        this._paused = false;
        this._frameCount = 0;
        this._seekOffsetMs = seekMs;
        this.ytdlpStderrLines = [];
        this.ffmpegStderrLines = [];
        this.failureEmitted = false;
        this.endedRunId = -1;

        const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

        const ytdlpArgs = [
            '--no-playlist',
            '--no-warnings',
            '--paths', `temp:${YTDLP_TEMP_DIR}`,
            '--js-runtimes', 'quickjs:/usr/bin/qjs',
            '--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl}`,
            '-f', 'ba/b',
            '-o', '-',
        ];

        if (process.env.YTDLP_COOKIES_PATH) {
            ytdlpArgs.push('--cookies', process.env.YTDLP_COOKIES_PATH);
        }

        ytdlpArgs.push(this.url);

        const ffmpegArgs = [
            '-loglevel', 'error',
            '-probesize', '32k',
            '-analyzeduration', '0',
            '-i', 'pipe:0',
            ...(seekMs > 0 ? ['-ss', String(seekMs / 1000)] : []),
            '-vn',
            '-c:a', 'libopus',
            '-ar', '48000',
            '-ac', '1',
            '-b:a', '128k',
            '-f', 'ogg',
            'pipe:1',
        ];

        this.logger.info('pipeline.start', {
            url: truncateForLog(this.url),
            seekMs,
            commands: {
                ytdlp: ['yt-dlp', ...ytdlpArgs],
                ffmpeg: ['ffmpeg', ...ffmpegArgs],
            },
        });

        this.ytdlp = spawn('yt-dlp', ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        this.ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

        this.ytdlp.stdout!.on('error', () => {});
        this.ffmpeg.stdin!.on('error', () => {});

        this.ytdlp.stdout!.pipe(this.ffmpeg.stdin!);

        this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
            if (runId !== this.runId) return;
            this.buf = Buffer.concat([this.buf, chunk]);
            this.buf = extractOggPackets(this.buf, (pkt) => this.queue.push(pkt));
            this.logger.debug('ffmpeg.stdout.chunk', {
                chunkBytes: chunk.length,
                queueLength: this.queue.length,
                bufferedBytes: this.buf.length,
            });
        });

        this.ytdlp.stderr!.on('data', (d: Buffer) => {
            if (runId !== this.runId) return;
            appendStderrLines(this.ytdlpStderrLines, d);
            this.logger.debug('ytdlp.stderr', { message: d.toString() });
        });

        this.ffmpeg.stderr!.on('data', (d: Buffer) => {
            if (runId !== this.runId) return;
            appendStderrLines(this.ffmpegStderrLines, d);
            const msg = d.toString();
            if (!msg.includes('Error parsing Opus packet header')) {
                this.logger.debug('ffmpeg.stderr', { message: msg });
            }
        });

        this.ytdlp.on('error', (error) => {
            if (runId !== this.runId) return;
            this.logger.error('ytdlp.process_error', {
                url: truncateForLog(this.url),
                error,
            });
            this.emitProcessFailure('yt-dlp', {
                stderrSummary: summarizeStderrLines(this.ytdlpStderrLines),
            });
        });
        this.ffmpeg.on('error', (error) => {
            if (runId !== this.runId) return;
            this.logger.error('ffmpeg.process_error', {
                url: truncateForLog(this.url),
                error,
            });
            this.emitProcessFailure('ffmpeg', {
                stderrSummary: summarizeStderrLines(this.ffmpegStderrLines),
            });
        });

        this.ytdlp.on('exit', (code, signal) => {
            if (runId !== this.runId) return;
            const stderrSummary = summarizeStderrLines(this.ytdlpStderrLines);
            const summary = {
                code,
                signal,
                framesProduced: this._frameCount > 0,
                frameCount: this._frameCount,
                stderrSummary,
            };
            if (code !== 0 && code !== null) {
                this.logger.error('ytdlp.exit.unexpected', summary);
                if (this._frameCount === 0) {
                    this.emitProcessFailure('yt-dlp', { code, signal, stderrSummary });
                }
            } else {
                this.logger.info('ytdlp.exit', summary);
            }
        });

        this.ffmpeg.on('close', (code) => {
            if (runId !== this.runId) return;
            const stderrSummary = summarizeStderrLines(this.ffmpegStderrLines);
            const summary = {
                code,
                framesProduced: this._frameCount > 0,
                frameCount: this._frameCount,
                stderrSummary,
            };
            if (code !== 0 && code !== null) {
                this.logger.error('ffmpeg.close.unexpected', summary);
                if (this._frameCount === 0) {
                    this.emitProcessFailure('ffmpeg', { code, stderrSummary });
                }
            } else {
                this.logger.info('ffmpeg.close', summary);
            }
            if (runId !== this.runId || !this._running) return;
            this._drainCheck = setInterval(() => {
                if (runId !== this.runId) return;
                if (this.queue.length === 0) {
                    this.finishRun(runId, code);
                }
            }, OPUS_FRAME_MS);
        });

        this.timer = setInterval(() => {
            if (runId !== this.runId) return;
            if (this._paused) return;
            if (this.queue.length > 0) {
                const frame = this.queue.shift()!;
                this._frameCount++;
                this.logger.debug('audio.frame.emitted', {
                    frameCount: this._frameCount,
                    queueRemaining: this.queue.length,
                    positionMs: this.positionMs,
                });
                this.emit('frame', { data: frame, durationMs: OPUS_FRAME_MS } satisfies OpusFrame);
            }
        }, OPUS_FRAME_MS);
    }

    stop(): void {
        if (!this._running) return;
        this.runId += 1;
        this._running = false;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this._drainCheck) {
            clearInterval(this._drainCheck);
            this._drainCheck = null;
        }

        this._paused = false;
        this._frameCount = 0;
        this._seekOffsetMs = 0;
        this.failureEmitted = false;
        this.endedRunId = -1;

        this.logger.info('pipeline.stop');

        try { this.ffmpeg?.stdin?.end(); } catch { /* already closed */ }
        this.ytdlp?.kill('SIGTERM');
        this.ffmpeg?.kill('SIGTERM');

        this.ytdlp = null;
        this.ffmpeg = null;
        this.buf = Buffer.alloc(0);
        this.queue = [];
    }

    pause(): void {
        if (this._running && !this._paused) {
            this._paused = true;
            this.logger.info('pipeline.pause', { positionMs: this.positionMs });
        }
    }

    resume(): void {
        if (this._running && this._paused) {
            this._paused = false;
            this.logger.info('pipeline.resume', { positionMs: this.positionMs });
        }
    }

    seek(ms: number): void {
        this.logger.info('pipeline.seek', { ms, previousPositionMs: this.positionMs });
        this.stop();
        this.start(Math.max(0, ms));
    }

    private finishRun(runId: number, code: number | null): void {
        if (runId !== this.runId || this.endedRunId === runId) return;
        this.endedRunId = runId;
        if (this._drainCheck) {
            clearInterval(this._drainCheck);
            this._drainCheck = null;
        }
        this._running = false;
        this._paused = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.logger.info('pipeline.ended', { code });
        this.emit('ended', code);
    }
}
