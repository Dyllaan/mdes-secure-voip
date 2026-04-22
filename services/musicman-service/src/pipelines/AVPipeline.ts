/**
 * WebRTC media streaming pipeline for video/audio sync via yt-dlp into ffmpeg into IVF/OGG
 * Audio (Opus) drives playback clock via hrtime self-correcting timer.
 * Video frames carry encoded PTS timestamps; frames release when PTS <= audio position.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { type Readable } from 'stream';
import { OPUS_FRAME_MS, type OpusFrame } from './AudioPipeline';
import {
  appendStderrLines,
  createLogger,
  parseBooleanish,
  summarizeStderrLines,
  truncateForLog,
  type Logger,
} from '../logging';

export const VP8_PAYLOAD_TYPE = 96;
export const VP8_CLOCK_RATE = 90_000;
export const VP8_TIMESTAMP_STEP = Math.floor(VP8_CLOCK_RATE / 30);

const YTDLP_PRIME_BYTES = 128 * 1024;
const AUDIO_QUEUE_MAX = 500;
const FRAME_NS = BigInt(OPUS_FRAME_MS * 1_000_000);
const YTDLP_TEMP_DIR = (process.env.YTDLP_TEMP_DIR ?? '/tmp').trim() || '/tmp';

interface VideoFrame {
  ptsMs: number;
  data: Buffer;
}

interface IVFState {
  headerSkipped: boolean;
  framesTotal: number;
  fps: number;
  fpsNum: number;
  fpsDen: number;
}

function hexPrefix(buf: Buffer, n = 32): string {
  return buf.subarray(0, Math.min(n, buf.length)).toString('hex');
}

function asciiPrefix(buf: Buffer, n = 64): string {
  return buf
    .subarray(0, Math.min(n, buf.length))
    .toString('utf8')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '.')
    .replace(/\n/g, '\\n');
}

function detectContainerHint(buf: Buffer): string {
  if (buf.length < 8) return 'unknown (too short)';
  const h = buf.toString('hex', 0, 8);
  const a = buf.toString('ascii', 0, 4);
  if (a === 'ftyp' || buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4/m4a (ftyp box)';
  if (h.startsWith('1a45dfa3')) return 'webm/mkv (EBML)';
  if (a === 'RIFF') return 'avi/wav (RIFF)';
  if (a === 'OggS') return 'ogg';
  if (h.startsWith('fff') || h.startsWith('ffe') || h.startsWith('494433')) return 'mp3/id3';
  if (h.startsWith('000000') && buf[4] === 0x20) return 'mp4 (ftyp offset 4)';
  const boxSize = buf.readUInt32BE(0);
  const boxType = buf.toString('ascii', 4, 8);
  if (boxSize > 0 && boxSize < 1024 && /^[a-z]{4}$/.test(boxType)) {
    return `mp4-like (box: ${boxType}, size: ${boxSize})`;
  }
  return `unknown (hex: ${h})`;
}

function extractOggPackets(
  buf: Buffer,
  onPacket: (pkt: Buffer) => void,
  logger: Logger,
  debugEnabled: boolean,
): Buffer {
  let offset = 0;
  let extracted = 0;

  while (offset + 27 <= buf.length) {
    if (buf.toString('ascii', offset, offset + 4) !== 'OggS') {
      const next = buf.indexOf('OggS', offset + 1);
      if (next === -1) {
        if (debugEnabled) {
          logger.debug('ogg.no_sync_word', {
            tailLen: buf.length - offset,
            prefixHex: hexPrefix(buf.subarray(offset)),
          });
        }
        return buf.subarray(offset);
      }
      if (debugEnabled) logger.debug('ogg.resync', { from: offset, to: next, skipped: next - offset });
      offset = next;
      continue;
    }

    const headerType = buf[offset + 5];
    const numSegments = buf[offset + 26];
    if (offset + 27 + numSegments > buf.length) break;

    const segTable: number[] = [];
    for (let i = 0; i < numSegments; i++) segTable.push(buf[offset + 27 + i]);

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
            extracted++;
          }
          pktStart += pktLen;
          pktLen = 0;
        }
      }
    }

    offset += pageSize;
  }

  if (debugEnabled && extracted > 0) logger.debug('ogg.extracted', { packetCount: extracted });
  return buf.subarray(offset);
}

function extractIVFFrames(
  buf: Buffer,
  onFrame: (frame: VideoFrame) => void,
  state: IVFState,
  logger: Logger,
  debugEnabled: boolean,
): Buffer {
  let offset = 0;
  let extracted = 0;

  if (!state.headerSkipped) {
    if (buf.length < 4) return buf;
    if (buf.toString('ascii', 0, 4) === 'DKIF') {
      if (buf.length < 32) return buf;
      const codec = buf.toString('ascii', 8, 12);
      const width = buf.readUInt16LE(12);
      const height = buf.readUInt16LE(14);
      state.fpsNum = buf.readUInt32LE(16);
      state.fpsDen = buf.readUInt32LE(20);
      state.fps = state.fpsNum > 0 && state.fpsDen > 0 ? state.fpsNum / state.fpsDen : 30;
      logger.debug('ivf.header', { codec, width, height, fps: `${state.fpsNum}/${state.fpsDen}` });
      offset = 32;
    } else {
      logger.warn('ivf.magic_unexpected', { hex: hexPrefix(buf, 8), ascii: asciiPrefix(buf, 8) });
    }
    state.headerSkipped = true;
  }

  while (offset + 12 <= buf.length) {
    const frameSize = buf.readUInt32LE(offset);
    if (frameSize === 0 || frameSize > 10_000_000) {
      logger.warn('ivf.invalid_frame_size', {
        frameSize,
        offset,
        remaining: buf.length - offset,
        hexAt: hexPrefix(buf.subarray(offset), 16),
      });
      return Buffer.alloc(0);
    }
    if (offset + 12 + frameSize > buf.length) break;

    const pts = buf.readBigUInt64LE(offset + 4);
    const ptsMs = state.fpsNum > 0
      ? Number(pts) * state.fpsDen / state.fpsNum * 1000
      : Number(pts) * (1000 / 30);

    onFrame({ ptsMs, data: Buffer.from(buf.subarray(offset + 12, offset + 12 + frameSize)) });
    extracted++;
    state.framesTotal++;
    if (debugEnabled) logger.debug('ivf.frame.extracted', { frameSize, pts: pts.toString(), ptsMs });
    offset += 12 + frameSize;
  }

  if (debugEnabled && extracted > 0) logger.debug('ivf.extracted', { frameCount: extracted, totalFrames: state.framesTotal });
  return buf.subarray(offset);
}

export class AVPipeline extends EventEmitter {
  private ytdlp: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;

  private audioBuf: Buffer = Buffer.alloc(0);
  private videoBuf: Buffer = Buffer.alloc(0);
  private audioQueue: Buffer[] = [];
  private videoQueue: VideoFrame[] = [];

  private audioTimer: NodeJS.Timeout | null = null;
  private drainCheck: NodeJS.Timeout | null = null;
  private ivfState: IVFState = { headerSkipped: false, framesTotal: 0, fps: 30, fpsNum: 30, fpsDen: 1 };

  private _running = false;
  private _paused = false;
  private _frameCount = 0;
  private _seekOffsetMs = 0;

  private _nextFrameNs: bigint = 0n;
  private _timerStopped = false;

  private _ytdlpPrimeBuffer: Buffer = Buffer.alloc(0);
  private _ytdlpPrimed = false;
  private _ytdlpBytesTotal = 0;
  private ytdlpStderrLines: string[] = [];
  private ffmpegStderrLines: string[] = [];
  private failureEmitted = false;
  private readonly logger: Logger;

  get running() { return this._running; }
  get isPaused() { return this._paused; }
  get positionMs() { return this._seekOffsetMs + this._frameCount * OPUS_FRAME_MS; }

  constructor(
    private readonly url: string,
    private readonly logContext = 'av-pipeline',
  ) {
    super();
    this.logger = createLogger('avPipeline', { logContext });
  }

  private get logPrefix(): string {
    return `[AVPipeline ${this.logContext}]`;
  }

  private get debugEnabled(): boolean {
    return parseBooleanish(process.env.DEBUG);
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
    this.ivfState = { headerSkipped: false, framesTotal: 0, fps: 30, fpsNum: 30, fpsDen: 1 };
    this.audioBuf = Buffer.alloc(0);
    this.videoBuf = Buffer.alloc(0);
    this.audioQueue = [];
    this.videoQueue = [];
    this._ytdlpPrimeBuffer = Buffer.alloc(0);
    this._ytdlpPrimed = false;
    this._ytdlpBytesTotal = 0;
    this._timerStopped = false;
    this.ytdlpStderrLines = [];
    this.ffmpegStderrLines = [];
    this.failureEmitted = false;

    const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

    const formatSelector =
      'best[height<=720][ext=mp4][vcodec!=none][acodec!=none]/'
      + 'best[height<=720][ext=webm][vcodec!=none][acodec!=none]/'
      + 'best[height<=720][vcodec!=none][acodec!=none]/'
      + 'best[vcodec!=none][acodec!=none]/'
      + 'best';

    const ytdlpArgs = [
      '--no-playlist',
      '--no-warnings',
      ...(this.debugEnabled ? ['--verbose'] : []),
      '--paths', `temp:${YTDLP_TEMP_DIR}`,
      '--js-runtimes', 'node:/usr/local/bin/node',
      '--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl}`,
      '-f', formatSelector,
      '--print', 'before_dl:%(format_id)s %(ext)s %(width)sx%(height)s %(vcodec)s+%(acodec)s',
      '-o', '-',
    ];

    if (process.env.YTDLP_COOKIES_PATH) {
      ytdlpArgs.push('--cookies', process.env.YTDLP_COOKIES_PATH);
    }

    ytdlpArgs.push(this.url);

    this.logger.info('pipeline.start', {
      url: truncateForLog(this.url),
      seekMs,
      commands: {
        ytdlp: ['yt-dlp', ...ytdlpArgs],
      },
    });

    this.ytdlp = spawn('yt-dlp', ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.ytdlp.on('spawn', () => this.logger.debug('ytdlp.spawned'));
    this.ytdlp.on('error', (error) => {
      appendStderrLines(this.ytdlpStderrLines, error.message);
      this.logger.error('ytdlp.process_error', {
        url: truncateForLog(this.url),
        error,
      });
      this.emitProcessFailure('yt-dlp', {
        stderrSummary: summarizeStderrLines(this.ytdlpStderrLines),
      });
    });
    this.ytdlp.on('exit', (code, signal) => {
      const stderrSummary = summarizeStderrLines(this.ytdlpStderrLines);
      const summary = {
        code,
        signal,
        framesProduced: this._frameCount > 0,
        audioFrames: this._frameCount,
        videoFrames: this.ivfState.framesTotal,
        stderrSummary,
      };
      if (code !== 0 && code !== null) {
        this.logger.error('ytdlp.exit.unexpected', summary);
        if (this._frameCount === 0 && this.ivfState.framesTotal === 0) {
          this.emitProcessFailure('yt-dlp', { code, signal, stderrSummary });
        }
      } else {
        this.logger.info('ytdlp.exit', summary);
      }
    });

    this.ytdlp.stderr!.on('data', (d: Buffer) => {
      appendStderrLines(this.ytdlpStderrLines, d);
      this.logger.debug('ytdlp.stderr', { message: d.toString().trimEnd() });
    });

    this.ytdlp.stdout!.on('data', (chunk: Buffer) => {
      this._ytdlpBytesTotal += chunk.length;
      this.logger.debug('ytdlp.stdout.chunk', {
        bytes: chunk.length,
        totalBytes: this._ytdlpBytesTotal,
        primed: this._ytdlpPrimed,
      });

      if (this._ytdlpPrimed) return;

      this._ytdlpPrimeBuffer = Buffer.concat([this._ytdlpPrimeBuffer, chunk]);

      if (this._ytdlpPrimeBuffer.length >= YTDLP_PRIME_BYTES) {
        this._ytdlpPrimed = true;
        this.logger.info('ytdlp.prime_threshold.reached', {
          primeBytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
        this.ytdlp!.stdout!.pause();
        this._spawnFfmpeg(seekMs);
      }
    });

    this.ytdlp.stdout!.on('end', () => {
      this.logger.debug('ytdlp.stdout.end', {
        primed: this._ytdlpPrimed,
        primeBufLen: this._ytdlpPrimeBuffer.length,
        totalBytes: this._ytdlpBytesTotal,
      });
      if (!this._ytdlpPrimed && this._ytdlpPrimeBuffer.length > 0) {
        this.logger.warn('ytdlp.stdout.ended_before_prime', {
          bytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
        this._ytdlpPrimed = true;
        this._spawnFfmpeg(seekMs);
      }
    });

    this.ytdlp.stdout!.on('close', () => this.logger.debug('ytdlp.stdout.close'));
    this.ytdlp.stdout!.on('error', (error) => this.logger.warn('ytdlp.stdout.error', { error }));
  }

  private _spawnFfmpeg(seekMs: number): void {
    const inputSeekArgs = seekMs > 0 ? ['-ss', String(seekMs / 1000)] : [];

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', this.debugEnabled ? 'debug' : 'info',
      '-probesize', '10M',
      '-analyzeduration', '10M',
      '-fflags', '+genpts+igndts',
      '-re',
      ...inputSeekArgs,
      '-i', 'pipe:0',
      '-map', '0:a:0',
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '1',
      '-b:a', '128k',
      '-f', 'ogg',
      'pipe:1',
      '-map', '0:v:0',
      '-c:v', 'libvpx',
      '-b:v', '1500k',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-f', 'ivf',
      'pipe:3',
    ];

    this.logger.info('ffmpeg.spawn.start', {
      url: truncateForLog(this.url),
      commands: {
        ffmpeg: ['ffmpeg', ...ffmpegArgs],
      },
    });

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    this.ffmpeg.on('spawn', () => {
      this.logger.info('ffmpeg.spawned', { primeBytes: this._ytdlpPrimeBuffer.length });

      const canContinue = this.ffmpeg!.stdin!.write(this._ytdlpPrimeBuffer, (err) => {
        if (err) this.logger.warn('ffmpeg.prime_write.failed', { error: err });
        else this.logger.debug('ffmpeg.prime_write.completed');
      });

      if (!canContinue) {
        this.logger.debug('ffmpeg.stdin.backpressure');
        this.ffmpeg!.stdin!.once('drain', () => {
          this.logger.debug('ffmpeg.stdin.drain');
          this._pipeYtdlpToFfmpeg();
        });
      } else {
        this._pipeYtdlpToFfmpeg();
      }
    });

    this.ffmpeg.stdin!.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
        this.logger.debug('ffmpeg.stdin.epipe');
      } else {
        this.logger.warn('ffmpeg.stdin.error', { error });
      }
    });

    this.ffmpeg.stderr!.on('data', (d: Buffer) => {
      appendStderrLines(this.ffmpegStderrLines, d);
      const msg = d.toString();
      this.logger.debug('ffmpeg.stderr', { message: msg.trimEnd() });

      if (msg.includes('Invalid data found when processing input')) {
        this.logger.warn('ffmpeg.container_probe_failure', {
          primeBytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
      }
      if (msg.includes('Error opening input')) this.logger.warn('ffmpeg.input_open_failed');
      if (msg.includes('moov atom not found')) this.logger.warn('ffmpeg.moov_atom_missing');
    });

    this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
      this.audioBuf = Buffer.concat([this.audioBuf, chunk]);
      const before = this.audioQueue.length;
      this.audioBuf = extractOggPackets(
        this.audioBuf,
        (pkt) => {
          if (this.audioQueue.length < AUDIO_QUEUE_MAX) {
            this.audioQueue.push(pkt);
          } else {
            this.logger.debug('audio.queue.cap_reached');
          }
        },
        this.logger,
        this.debugEnabled,
      );
      this.logger.debug('ffmpeg.audio_queue.updated', {
        chunkBytes: chunk.length,
        queueBefore: before,
        queueAfter: this.audioQueue.length,
        bufferedBytes: this.audioBuf.length,
      });
    });

    const videoPipe = this.ffmpeg.stdio[3] as Readable;
    videoPipe.on('data', (chunk: Buffer) => {
      this.videoBuf = Buffer.concat([this.videoBuf, chunk]);
      this.videoBuf = extractIVFFrames(
        this.videoBuf,
        (frame) => { this.videoQueue.push(frame); },
        this.ivfState,
        this.logger,
        this.debugEnabled,
      );
      this.logger.debug('ffmpeg.video_queue.updated', {
        chunkBytes: chunk.length,
        queueLength: this.videoQueue.length,
        bufferedBytes: this.videoBuf.length,
      });
    });

    this.ffmpeg.on('error', (error) => {
      appendStderrLines(this.ffmpegStderrLines, error.message);
      this.logger.error('ffmpeg.process_error', {
        url: truncateForLog(this.url),
        error,
      });
      this.emitProcessFailure('ffmpeg', {
        stderrSummary: summarizeStderrLines(this.ffmpegStderrLines),
      });
    });

    this.ffmpeg.on('exit', (code, signal) => {
      const stderrSummary = summarizeStderrLines(this.ffmpegStderrLines);
      const summary = {
        code,
        signal,
        framesProduced: this._frameCount > 0,
        audioFrames: this._frameCount,
        videoFrames: this.ivfState.framesTotal,
        stderrSummary,
      };
      if (code !== 0 && code !== null && signal === null) {
        this.logger.error('ffmpeg.exit.unexpected', summary);
        if (this._frameCount === 0 && this.ivfState.framesTotal === 0) {
          this.emitProcessFailure('ffmpeg', { code, signal, stderrSummary });
        }
      } else {
        this.logger.info('ffmpeg.exit', summary);
      }
    });

    this.ffmpeg.on('close', (code, signal) => {
      const stderrSummary = summarizeStderrLines(this.ffmpegStderrLines);
      const summary = {
        code,
        signal,
        framesProduced: this._frameCount > 0,
        audioFrames: this._frameCount,
        videoFrames: this.ivfState.framesTotal,
        stderrSummary,
      };
      if (code !== 0 && code !== null) {
        this.logger.error('ffmpeg.close.unexpected', summary);
      } else {
        this.logger.info('ffmpeg.close', summary);
      }

      this.drainCheck = setInterval(() => {
        if (this.audioQueue.length === 0) {
          if (this.drainCheck) {
            clearInterval(this.drainCheck);
            this.drainCheck = null;
          }
          this._running = false;
          this._paused = false;
          this._timerStopped = true;
          this.logger.info('pipeline.ended', { code });
          this.emit('ended', code);
        } else {
          this.logger.debug('audio.queue.waiting_for_drain', { remaining: this.audioQueue.length });
        }
      }, OPUS_FRAME_MS);
    });

    this._nextFrameNs = process.hrtime.bigint() + FRAME_NS;
    this._timerStopped = false;

    const tick = () => {
      if (this._timerStopped) return;

      if (!this._paused) {
        if (this.audioQueue.length > 0) {
          const frame = this.audioQueue.shift()!;
          this._frameCount++;

          this.logger.debug('audio.frame.emitted', {
            frameCount: this._frameCount,
            positionMs: this.positionMs,
            queueRemaining: this.audioQueue.length,
            frameLen: frame.length,
          });

          this.emit('audioFrame', { data: frame, durationMs: OPUS_FRAME_MS } satisfies OpusFrame);
        }

        const posMs = this.positionMs;
        while (this.videoQueue.length > 0 && this.videoQueue[0].ptsMs <= posMs) {
          const frame = this.videoQueue.shift()!;
          this.logger.debug('video.frame.emitted', {
            ptsMs: frame.ptsMs,
            positionMs: posMs,
            queueRemaining: this.videoQueue.length,
          });
          this.emit('videoFrame', frame.data);
        }
      }

      this._nextFrameNs += FRAME_NS;
      const now = process.hrtime.bigint();
      const delayMs = Number(this._nextFrameNs - now) / 1_000_000;
      this.audioTimer = setTimeout(tick, Math.max(0, delayMs));
    };

    const initialDelayMs = Number(this._nextFrameNs - process.hrtime.bigint()) / 1_000_000;
    this.audioTimer = setTimeout(tick, Math.max(0, initialDelayMs));
  }

  private _pipeYtdlpToFfmpeg(): void {
    if (!this.ytdlp?.stdout || !this.ffmpeg?.stdin) {
      this.logger.warn('pipeline.pipe_unavailable');
      return;
    }
    this.logger.debug('pipeline.pipe_ytdlp_to_ffmpeg');
    this.ytdlp.stdout.pipe(this.ffmpeg.stdin);
    this.ytdlp.stdout.resume();
  }

  stop(): void {
    if (!this._running && !this.ytdlp && !this.ffmpeg) return;

    this.logger.info('pipeline.stop', {
      running: this._running,
      frameCount: this._frameCount,
      positionMs: this.positionMs,
    });

    this._running = false;
    this._timerStopped = true;

    if (this.audioTimer) { clearTimeout(this.audioTimer); this.audioTimer = null; }
    if (this.drainCheck) { clearInterval(this.drainCheck); this.drainCheck = null; }

    this._paused = false;
    this._frameCount = 0;
    this._seekOffsetMs = 0;

    try { this.ffmpeg?.stdin?.end(); } catch { /* ignore */ }

    if (this.ytdlp) this.ytdlp.kill('SIGTERM');
    if (this.ffmpeg) this.ffmpeg.kill('SIGTERM');

    this.ytdlp = null;
    this.ffmpeg = null;
    this.audioBuf = Buffer.alloc(0);
    this.videoBuf = Buffer.alloc(0);
    this.audioQueue = [];
    this.videoQueue = [];
    this.ivfState = { headerSkipped: false, framesTotal: 0, fps: 30, fpsNum: 30, fpsDen: 1 };
    this._ytdlpPrimeBuffer = Buffer.alloc(0);
    this._ytdlpPrimed = false;
    this._ytdlpBytesTotal = 0;
    this.failureEmitted = false;
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
    this.logger.info('pipeline.seek', { ms, currentPositionMs: this.positionMs });
    this.stop();
    this.start(Math.max(0, ms));
  }
}
