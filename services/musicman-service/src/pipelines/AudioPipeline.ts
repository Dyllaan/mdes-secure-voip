/**
 * AudioPipeline
 *
 * Spawns a yt-dlp | ffmpeg subprocess pipeline to extract Opus audio frames
 * from a URL, emitting 'frame' events at 20ms intervals and an 'ended' event
 * when the stream finishes. Supports pause/resume and seek.
 * ONLY USED WHEN VIDEO MODE IS DISABLED. In video mode, the AVPipeline class is used instead,
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { appendStderrLines, summarizeStderrLines, truncateForLog } from '../logging';

export const OPUS_FRAME_MS = 20;
export const SAMPLE_RATE = 48_000;
export const CHANNELS = 1;
export const RTP_TIMESTAMP_STEP = SAMPLE_RATE * OPUS_FRAME_MS / 1000;

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

    get running() { return this._running; }
    get isPaused() { return this._paused; }
    get positionMs() { return this._seekOffsetMs + this._frameCount * OPUS_FRAME_MS; }

    constructor(
        private readonly url: string,
        private readonly logContext = 'audio-pipeline',
    ) {
        super();
    }

    private get logPrefix(): string {
        return `[AudioPipeline ${this.logContext}]`;
    }

    private recordStderr(target: string[], chunk: Buffer): void {
        appendStderrLines(target, chunk);
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
        this._running = true;
        this._paused = false;
        this._frameCount = 0;
        this._seekOffsetMs = seekMs;
        this.ytdlpStderrLines = [];
        this.ffmpegStderrLines = [];
        this.failureEmitted = false;

        const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

        const ytdlpArgs = [
            '--no-playlist',
            '--no-warnings',
            '--js-runtimes', 'quickjs:/usr/bin/qjs',
            '--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl}`,
            '-f', 'ba/b',
            '-o', '-',
        ];

        if (process.env.YTDLP_COOKIES_PATH) {
            ytdlpArgs.push('--cookies', process.env.YTDLP_COOKIES_PATH);
        }

        ytdlpArgs.push(this.url);

        this.ytdlp = spawn('yt-dlp', ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

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

        console.log(`${this.logPrefix} Starting`, {
            url: truncateForLog(this.url),
            seekMs,
            commands: {
                ytdlp: ['yt-dlp', ...ytdlpArgs],
                ffmpeg: ['ffmpeg', ...ffmpegArgs],
            },
        });

        this.ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

        this.ytdlp.stdout!.on('error', () => {});
        this.ffmpeg.stdin!.on('error', () => {});

        this.ytdlp.stdout!.pipe(this.ffmpeg.stdin!);

        this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
            this.buf = Buffer.concat([this.buf, chunk]);
            this.buf = extractOggPackets(this.buf, (pkt) => this.queue.push(pkt));
        });

        this.ytdlp.stderr!.on('data', (d: Buffer) => {
            this.recordStderr(this.ytdlpStderrLines, d);
            process.stderr.write(`[yt-dlp] ${d}`);
        });

        this.ffmpeg.stderr!.on('data', (d: Buffer) => {
            this.recordStderr(this.ffmpegStderrLines, d);
            const msg = d.toString();
            if (!msg.includes('Error parsing Opus packet header')) {
                process.stderr.write(`[ffmpeg] ${msg}`);
            }
        });

        this.ytdlp.on('error', (e) => {
            console.error(`${this.logPrefix} yt-dlp process error`, {
                url: truncateForLog(this.url),
                error: e.message,
            });
            this.emitProcessFailure('yt-dlp', {
                stderrSummary: summarizeStderrLines(this.ytdlpStderrLines),
            });
        });
        this.ffmpeg.on('error', (e) => {
            console.error(`${this.logPrefix} ffmpeg process error`, {
                url: truncateForLog(this.url),
                error: e.message,
            });
            this.emitProcessFailure('ffmpeg', {
                stderrSummary: summarizeStderrLines(this.ffmpegStderrLines),
            });
        });

        this.ytdlp.on('exit', (code, signal) => {
            const stderrSummary = summarizeStderrLines(this.ytdlpStderrLines);
            const summary = {
                code,
                signal,
                framesProduced: this._frameCount > 0,
                frameCount: this._frameCount,
                stderrSummary,
            };
            if (code !== 0 && code !== null) {
                console.error(`${this.logPrefix} yt-dlp exited unexpectedly`, summary);
                if (this._frameCount === 0) {
                    this.emitProcessFailure('yt-dlp', { code, signal, stderrSummary });
                }
            } else {
                console.log(`${this.logPrefix} yt-dlp exited`, summary);
            }
        });

        this.ffmpeg.on('close', (code) => {
            const stderrSummary = summarizeStderrLines(this.ffmpegStderrLines);
            const summary = {
                code,
                framesProduced: this._frameCount > 0,
                frameCount: this._frameCount,
                stderrSummary,
            };
            if (code !== 0 && code !== null) {
                console.error(`${this.logPrefix} ffmpeg closed unexpectedly`, summary);
                if (this._frameCount === 0) {
                    this.emitProcessFailure('ffmpeg', { code, stderrSummary });
                }
            } else {
                console.log(`${this.logPrefix} ffmpeg closed`, summary);
            }
            this._running = false;
            this._drainCheck = setInterval(() => {
                if (this.queue.length === 0) {
                    if (this._drainCheck) { clearInterval(this._drainCheck); this._drainCheck = null; }
                    if (this.timer) { clearInterval(this.timer); this.timer = null; }
                    this.emit('ended', code);
                }
            }, OPUS_FRAME_MS);
        });

        this.timer = setInterval(() => {
            if (this._paused) return;
            if (this.queue.length > 0) {
                const frame = this.queue.shift()!;
                this._frameCount++;
                this.emit('frame', { data: frame, durationMs: OPUS_FRAME_MS } satisfies OpusFrame);
            }
        }, OPUS_FRAME_MS);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;

        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this._drainCheck) { clearInterval(this._drainCheck); this._drainCheck = null; }

        this._paused = false;
        this._frameCount = 0;
        this._seekOffsetMs = 0;
        this.failureEmitted = false;

        try { this.ffmpeg?.stdin?.end(); } catch { /* already closed */ }
        this.ytdlp?.kill('SIGTERM');
        this.ffmpeg?.kill('SIGTERM');

        this.ytdlp = null;
        this.ffmpeg = null;
        this.buf = Buffer.alloc(0);
        this.queue = [];
    }

    pause(): void {
        if (this._running && !this._paused) this._paused = true;
    }

    resume(): void {
        if (this._running && this._paused) this._paused = false;
    }

    seek(ms: number): void {
        this.stop();
        this.start(Math.max(0, ms));
    }
}
