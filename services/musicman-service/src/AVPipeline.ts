/**
 * WebRTC media streaming pipeline for video/audio sync via yt-dlp into ffmpeg into IVF/OGG
 * Audio (Opus) drives playback clock via hrtime self-correcting timer.
 * Video frames carry encoded PTS timestamps; frames release when PTS <= audio position.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { type Readable } from 'stream';
import { OPUS_FRAME_MS, type OpusFrame } from './AudioPipeline';

export const VP8_PAYLOAD_TYPE = 96;
export const VP8_CLOCK_RATE = 90_000;
export const VP8_TIMESTAMP_STEP = Math.floor(VP8_CLOCK_RATE / 30);

const DEBUG_AV = process.env.DEBUG_AV === '1' || process.env.DEBUG_AV_VERBOSE === '1';
const DEBUG_AV_VERBOSE = process.env.DEBUG_AV_VERBOSE === '1';

const YTDLP_PRIME_BYTES = 128 * 1024;
const AUDIO_QUEUE_MAX = 500;

const FRAME_NS = BigInt(OPUS_FRAME_MS * 1_000_000);

let _avLogSeq = 0;
function avLog(...args: unknown[]) {
  if (DEBUG_AV) {
    const seq = String(++_avLogSeq).padStart(5, '0');
    console.error(`[av #${seq}]`, ...args);
  }
}

function avWarn(...args: unknown[]) {
  console.error('[av WARN]', ...args);
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

function extractOggPackets(buf: Buffer, onPacket: (pkt: Buffer) => void): Buffer {
  let offset = 0;
  let extracted = 0;
  let pagesProcessed = 0;

  while (offset + 27 <= buf.length) {
    if (buf.toString('ascii', offset, offset + 4) !== 'OggS') {
      const next = buf.indexOf('OggS', offset + 1);
      if (next === -1) {
        avLog('ogg: no more sync words, holding tail', {
          tailLen: buf.length - offset,
          prefixHex: hexPrefix(buf.subarray(offset)),
        });
        return buf.subarray(offset);
      }
      avLog('ogg: resync', { from: offset, to: next, skipped: next - offset });
      offset = next;
      continue;
    }

    const headerType = buf[offset + 5];
    const numSegments = buf[offset + 26];
    if (offset + 27 + numSegments > buf.length) {
      avLog('ogg: incomplete segment table, holding', { offset, numSegments, available: buf.length - offset });
      break;
    }

    const segTable: number[] = [];
    for (let i = 0; i < numSegments; i++) segTable.push(buf[offset + 27 + i]);

    const bodySize = segTable.reduce((a, b) => a + b, 0);
    const pageSize = 27 + numSegments + bodySize;

    if (offset + pageSize > buf.length) {
      avLog('ogg: incomplete page body, holding', { offset, pageSize, available: buf.length - offset });
      break;
    }

    pagesProcessed++;
    const isBOS = (headerType & 0x02) !== 0;
    const isContinued = (headerType & 0x01) !== 0;

    if (DEBUG_AV_VERBOSE) {
      avLog('ogg: page', {
        offset, pageSize,
        headerType: `0x${headerType.toString(16)}`,
        isBOS, isContinued, numSegments, bodySize,
      });
    }

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
          } else {
            avLog('ogg: skipping header packet', { tag });
          }
          pktStart += pktLen;
          pktLen = 0;
        }
      }
    }

    offset += pageSize;
  }

  if (extracted > 0) avLog('ogg: extracted packets this call', { count: extracted, pagesProcessed });
  return buf.subarray(offset);
}

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

function extractIVFFrames(
  buf: Buffer,
  onFrame: (frame: VideoFrame) => void,
  state: IVFState,
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
      state.fps = state.fpsNum > 0 && state.fpsDen > 0
        ? state.fpsNum / state.fpsDen
        : 30;
      avLog('ivf: header', { codec, width, height, fps: `${state.fpsNum}/${state.fpsDen}`, resolvedFps: state.fps });
      offset = 32;
    } else {
      avWarn('ivf: expected DKIF magic, got', { hex: hexPrefix(buf, 8), ascii: asciiPrefix(buf, 8) });
    }
    state.headerSkipped = true;
  }

  while (offset + 12 <= buf.length) {
    const frameSize = buf.readUInt32LE(offset);
    if (frameSize === 0 || frameSize > 10_000_000) {
      avWarn('ivf: invalid frame size, dropping remaining buffer', {
        frameSize, offset,
        remaining: buf.length - offset,
        hexAt: hexPrefix(buf.subarray(offset), 16),
      });
      return Buffer.alloc(0);
    }
    if (offset + 12 + frameSize > buf.length) {
      avLog('ivf: partial frame, holding', { frameSize, available: buf.length - offset - 12 });
      break;
    }

    const pts = buf.readBigUInt64LE(offset + 4);

    const ptsMs = state.fpsNum > 0
      ? Number(pts) * state.fpsDen / state.fpsNum * 1000
      : Number(pts) * (1000 / 30);

    onFrame({ ptsMs, data: Buffer.from(buf.subarray(offset + 12, offset + 12 + frameSize)) });
    extracted++;
    state.framesTotal++;

    if (DEBUG_AV_VERBOSE) {
      avLog('ivf: frame', { frameSize, pts: pts.toString(), ptsMs, total: state.framesTotal });
    }
    offset += 12 + frameSize;
  }

  if (extracted > 0) avLog('ivf: extracted frames this call', { count: extracted, total: state.framesTotal });
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

  get running() { return this._running; }
  get isPaused() { return this._paused; }
  get positionMs() { return this._seekOffsetMs + this._frameCount * OPUS_FRAME_MS; }

  constructor(private readonly youtubeUrl: string) {
    super();
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

    const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

    const formatSelector =
      'best[height<=720][ext=mp4][vcodec!=none][acodec!=none]/' +
      'best[height<=720][ext=webm][vcodec!=none][acodec!=none]/' +
      'best[height<=720][vcodec!=none][acodec!=none]/' +
      'best[vcodec!=none][acodec!=none]/' +
      'best';

    const ytdlpArgs = [
      '--no-playlist',
      '--no-warnings',
      ...(DEBUG_AV_VERBOSE ? ['--verbose'] : []),
      '--js-runtimes', 'node:/usr/local/bin/node',
      '--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl}`,
      '-f', formatSelector,
      '--print', 'before_dl:%(format_id)s %(ext)s %(width)sx%(height)s %(vcodec)s+%(acodec)s',
      '-o', '-',
    ];

    if (process.env.YTDLP_COOKIES_PATH) {
      ytdlpArgs.push('--cookies', process.env.YTDLP_COOKIES_PATH);
    }

    ytdlpArgs.push(this.youtubeUrl);

    avLog('ytdlp: spawning', { url: this.youtubeUrl, seekMs, formatSelector });

    this.ytdlp = spawn('yt-dlp', ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.ytdlp.on('spawn', () => avLog('ytdlp: spawned'));
    this.ytdlp.on('error', (e) => { avWarn('ytdlp: spawn error', e); this.emit('error', e); });
    this.ytdlp.on('exit', (code, signal) => {
      avLog('ytdlp: exit', { code, signal, bytesTotal: this._ytdlpBytesTotal });
      if (code !== 0 && code !== null) avWarn('ytdlp: non-zero exit', { code, signal });
    });

    this.ytdlp.stderr!.on('data', (d: Buffer) => {
      const msg = d.toString();
      process.stderr.write(`[yt-dlp/av] ${msg}`);
      if (DEBUG_AV) avLog('ytdlp: stderr', msg.trimEnd());
    });

    this.ytdlp.stdout!.on('data', (chunk: Buffer) => {
      this._ytdlpBytesTotal += chunk.length;
      avLog('ytdlp: stdout chunk', { len: chunk.length, totalSoFar: this._ytdlpBytesTotal, primed: this._ytdlpPrimed });

      if (this._ytdlpPrimed) return;

      this._ytdlpPrimeBuffer = Buffer.concat([this._ytdlpPrimeBuffer, chunk]);

      if (this._ytdlpPrimeBuffer.length >= YTDLP_PRIME_BYTES) {
        this._ytdlpPrimed = true;
        avLog('ytdlp: prime threshold reached', {
          primeBytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
        this.ytdlp!.stdout!.pause();
        this._spawnFfmpeg(seekMs);
      }
    });

    this.ytdlp.stdout!.on('end', () => {
      avLog('ytdlp: stdout end', { primed: this._ytdlpPrimed, primeBufLen: this._ytdlpPrimeBuffer.length, bytesTotal: this._ytdlpBytesTotal });
      if (!this._ytdlpPrimed && this._ytdlpPrimeBuffer.length > 0) {
        avWarn('ytdlp: stdout ended before prime threshold, spawning ffmpeg with partial buffer', {
          bytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
        this._ytdlpPrimed = true;
        this._spawnFfmpeg(seekMs);
      }
    });

    this.ytdlp.stdout!.on('close', () => avLog('ytdlp: stdout close'));
    this.ytdlp.stdout!.on('error', (e) => avWarn('ytdlp: stdout error', e));
  }

  private _spawnFfmpeg(seekMs: number): void {
    const inputSeekArgs = seekMs > 0 ? ['-ss', String(seekMs / 1000)] : [];

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', DEBUG_AV_VERBOSE ? 'debug' : 'info',
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

    avLog('ffmpeg: spawning', { ffmpegArgs });

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    this.ffmpeg.on('spawn', () => {
      avLog('ffmpeg: spawned - writing prime buffer', { primeBytes: this._ytdlpPrimeBuffer.length });

      const canContinue = this.ffmpeg!.stdin!.write(this._ytdlpPrimeBuffer, (err) => {
        if (err) avWarn('ffmpeg: error writing prime buffer', err);
        else avLog('ffmpeg: prime buffer written');
      });

      if (!canContinue) {
        avLog('ffmpeg: stdin backpressure after prime buffer, waiting for drain');
        this.ffmpeg!.stdin!.once('drain', () => {
          avLog('ffmpeg: stdin drained - resuming ytdlp stdout pipe');
          this._pipeYtdlpToFfmpeg();
        });
      } else {
        this._pipeYtdlpToFfmpeg();
      }
    });

    this.ffmpeg.stdin!.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'EPIPE') {
        avLog('ffmpeg: stdin EPIPE');
      } else {
        avWarn('ffmpeg: stdin error', e);
      }
    });

    this.ffmpeg.stderr!.on('data', (d: Buffer) => {
      const msg = d.toString();
      process.stderr.write(`[ffmpeg/av] ${msg}`);
      if (DEBUG_AV) avLog('ffmpeg: stderr', msg.trimEnd());

      if (msg.includes('Invalid data found when processing input')) {
        avWarn('ffmpeg: container probe failure', {
          primeBytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
      }
      if (msg.includes('Error opening input')) avWarn('ffmpeg: input open failed');
      if (msg.includes('moov atom not found')) avWarn('ffmpeg: moov atom missing - mp4 index at end, not streamable');
    });

    this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
      avLog('ffmpeg: audio chunk', { len: chunk.length, prefixHex: hexPrefix(chunk), prefixAscii: asciiPrefix(chunk) });
      this.audioBuf = Buffer.concat([this.audioBuf, chunk]);
      const before = this.audioQueue.length;
      this.audioBuf = extractOggPackets(this.audioBuf, (pkt) => {
        if (this.audioQueue.length < AUDIO_QUEUE_MAX) {
          this.audioQueue.push(pkt);
        } else {
          avLog('audio: queue cap reached, dropping packet');
        }
      });
      avLog('ffmpeg: audio queue', { before, after: this.audioQueue.length, bufRemaining: this.audioBuf.length });
    });

    const videoPipe = this.ffmpeg.stdio[3] as Readable;
    videoPipe.on('data', (chunk: Buffer) => {
      avLog('ffmpeg: video chunk', { len: chunk.length, prefixHex: hexPrefix(chunk), prefixAscii: asciiPrefix(chunk, 8) });
      this.videoBuf = Buffer.concat([this.videoBuf, chunk]);
      this.videoBuf = extractIVFFrames(
        this.videoBuf,
        (frame) => { this.videoQueue.push(frame); },
        this.ivfState,
      );
    });

    this.ffmpeg.on('error', (e) => { avWarn('ffmpeg: process error', e); this.emit('error', e); });

    this.ffmpeg.on('exit', (code, signal) => {
      avLog('ffmpeg: exit', { code, signal });
      if (code !== 0 && code !== null && signal === null) avWarn('ffmpeg: non-zero exit', { code });
    });

    this.ffmpeg.on('close', (code, signal) => {
      avLog('ffmpeg: close', {
        code, signal,
        audioQueueAtClose: this.audioQueue.length,
        videoFramesTotal: this.ivfState.framesTotal,
      });

      this._running = false;
      this.drainCheck = setInterval(() => {
        if (this.audioQueue.length === 0) {
          if (this.drainCheck) { clearInterval(this.drainCheck); this.drainCheck = null; }
          this._timerStopped = true;
          avLog('ffmpeg: audio queue drained - emitting ended', { code });
          this.emit('ended', code);
        } else {
          avLog('ffmpeg: waiting for audio queue drain', { remaining: this.audioQueue.length });
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

          if (DEBUG_AV_VERBOSE) {
            avLog('audio: frame emitted', {
              frameCount: this._frameCount,
              positionMs: this.positionMs,
              queueRemaining: this.audioQueue.length,
              frameLen: frame.length,
            });
          }

          this.emit('audioFrame', { data: frame, durationMs: OPUS_FRAME_MS } satisfies OpusFrame);
        }

        const posMs = this.positionMs;
        while (this.videoQueue.length > 0 && this.videoQueue[0].ptsMs <= posMs) {
          const vf = this.videoQueue.shift()!;
          if (DEBUG_AV_VERBOSE) {
            avLog('video: frame emitted', { ptsMs: vf.ptsMs, posMs, queueRemaining: this.videoQueue.length });
          }
          this.emit('videoFrame', vf.data);
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
      avWarn('_pipeYtdlpToFfmpeg: ytdlp or ffmpeg not available');
      return;
    }
    avLog('ytdlp: resuming stdout -> piping to ffmpeg stdin');
    this.ytdlp.stdout.pipe(this.ffmpeg.stdin);
    this.ytdlp.stdout.resume();
  }

  stop(): void {
    if (!this._running && !this.ytdlp && !this.ffmpeg) return;

    avLog('stop: called', { running: this._running, frameCount: this._frameCount, positionMs: this.positionMs });

    this._running = false;
    this._timerStopped = true;

    if (this.audioTimer) { clearTimeout(this.audioTimer); this.audioTimer = null; }
    if (this.drainCheck) { clearInterval(this.drainCheck); this.drainCheck = null; }

    this._paused = false;
    this._frameCount = 0;
    this._seekOffsetMs = 0;

    try { this.ffmpeg?.stdin?.end(); } catch (e) { avLog('stop: ffmpeg stdin end failed', e); }

    if (this.ytdlp) { avLog('stop: killing ytdlp'); this.ytdlp.kill('SIGTERM'); }
    if (this.ffmpeg) { avLog('stop: killing ffmpeg'); this.ffmpeg.kill('SIGTERM'); }

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
  }

  pause(): void {
    if (this._running && !this._paused) {
      this._paused = true;
      avLog('pause: paused at', { positionMs: this.positionMs });
    }
  }

  resume(): void {
    if (this._running && this._paused) {
      this._paused = false;
      avLog('resume: resumed at', { positionMs: this.positionMs });
    }
  }

  seek(ms: number): void {
    avLog('seek: requested', { ms, currentPositionMs: this.positionMs });
    this.stop();
    this.start(Math.max(0, ms));
  }
}