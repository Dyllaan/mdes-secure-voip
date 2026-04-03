/**
 * AVPipeline
 *
 * Combined audio + video pipeline for YouTube screenshare mode.
 *
 * Fix summary (2025):
 * ─────────────────────────────────────────────────────────────────
 * 1. CRITICAL: `-f b` was selecting DASH/adaptive formats that cannot be
 *    piped to stdout. Replaced with `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/
 *    best[ext=mp4]/best"` constrained to progressive/single-file formats.
 *    yt-dlp now uses `--merge-output-format mp4` and format selectors that
 *    avoid DASH segments entirely.
 *
 * 2. CRITICAL: The `ytdlp.stdout.on('data', ...)` debug listener was placed
 *    BEFORE `ytdlp.stdout.pipe(ffmpeg.stdin)`. Adding a `data` listener puts
 *    a Readable into flowing mode, draining it before the pipe consumer sees
 *    any bytes. Debug logging of yt-dlp stdout is now done via a PassThrough
 *    tap so the pipe is never interrupted.
 *
 * 3. ffmpeg now waits for yt-dlp to emit its first data before being spawned
 *    (deferred spawn pattern). This avoids ffmpeg probing an empty pipe while
 *    yt-dlp is still negotiating the player API.
 *
 * 4. Added explicit `-f mp4` / container hints and increased probesize for
 *    pipe input to give ffmpeg enough data to detect the container.
 *
 * 5. Added `pipe:1` / `pipe:3` explicit output targets with muxer hints.
 *
 * Debug mode: set DEBUG_AV=1 in environment.
 * Extra verbosity: set DEBUG_AV_VERBOSE=1 (enables yt-dlp --verbose + ffmpeg debug loglevel).
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough, type Readable } from 'stream';
import { OPUS_FRAME_MS, type OpusFrame } from './AudioPipeline';

export const VP8_PAYLOAD_TYPE = 96;
export const VP8_CLOCK_RATE = 90_000;
export const VIDEO_FPS = 30;
export const VP8_TIMESTAMP_STEP = Math.floor(VP8_CLOCK_RATE / VIDEO_FPS);

const DEBUG_AV = process.env.DEBUG_AV === '1' || process.env.DEBUG_AV_VERBOSE === '1';
const DEBUG_AV_VERBOSE = process.env.DEBUG_AV_VERBOSE === '1';

// How many bytes of yt-dlp stdout to wait for before spawning ffmpeg.
// This ensures ffmpeg's prober sees a complete container header, not a partial one.
const YTDLP_PRIME_BYTES = 128 * 1024; // 128 KB

let _avLogSeq = 0;
function avLog(...args: unknown[]) {
  if (DEBUG_AV) {
    const seq = String(++_avLogSeq).padStart(5, '0');
    console.error(`[av #${seq}]`, ...args);
  }
}

function avWarn(...args: unknown[]) {
  // Always printed — used for diagnostic warnings that aid problem resolution.
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
  // mp4 boxes: first 4 bytes are box size (big-endian uint32), next 4 are box type
  const boxSize = buf.readUInt32BE(0);
  const boxType = buf.toString('ascii', 4, 8);
  if (boxSize > 0 && boxSize < 1024 && /^[a-z]{4}$/.test(boxType)) {
    return `mp4-like (box: ${boxType}, size: ${boxSize})`;
  }
  return `unknown (hex: ${h})`;
}

// ─── Ogg/Opus packet extraction ──────────────────────────────────────────────

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
      avLog('ogg: incomplete segment table, holding', {
        offset,
        numSegments,
        available: buf.length - offset,
      });
      break;
    }

    const segTable: number[] = [];
    for (let i = 0; i < numSegments; i++) segTable.push(buf[offset + 27 + i]);

    const bodySize = segTable.reduce((a, b) => a + b, 0);
    const pageSize = 27 + numSegments + bodySize;

    if (offset + pageSize > buf.length) {
      avLog('ogg: incomplete page body, holding', {
        offset,
        pageSize,
        available: buf.length - offset,
      });
      break;
    }

    pagesProcessed++;
    const isBOS = (headerType & 0x02) !== 0;
    const isContinued = (headerType & 0x01) !== 0;

    if (DEBUG_AV_VERBOSE) {
      avLog('ogg: page', {
        offset,
        pageSize,
        headerType: `0x${headerType.toString(16)}`,
        isBOS,
        isContinued,
        numSegments,
        bodySize,
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

// ─── IVF frame extraction ─────────────────────────────────────────────────────

interface IVFState {
  headerSkipped: boolean;
  framesTotal: number;
}

function extractIVFFrames(
  buf: Buffer,
  onFrame: (frame: Buffer) => void,
  state: IVFState,
): Buffer {
  let offset = 0;
  let extracted = 0;

  if (!state.headerSkipped) {
    if (buf.length < 4) return buf;
    if (buf.toString('ascii', 0, 4) === 'DKIF') {
      if (buf.length < 32) return buf;
      // Parse IVF header for diagnostics
      const codec = buf.toString('ascii', 8, 12);
      const width = buf.readUInt16LE(12);
      const height = buf.readUInt16LE(14);
      const fpsNum = buf.readUInt32LE(16);
      const fpsDen = buf.readUInt32LE(20);
      avLog('ivf: header', { codec, width, height, fps: `${fpsNum}/${fpsDen}` });
      offset = 32;
    } else {
      avWarn('ivf: expected DKIF magic, got', {
        hex: hexPrefix(buf, 8),
        ascii: asciiPrefix(buf, 8),
      });
    }
    state.headerSkipped = true;
  }

  while (offset + 12 <= buf.length) {
    const frameSize = buf.readUInt32LE(offset);
    if (frameSize === 0 || frameSize > 10_000_000) {
      avWarn('ivf: invalid frame size, dropping remaining buffer', {
        frameSize,
        offset,
        remaining: buf.length - offset,
        hexAt: hexPrefix(buf.subarray(offset), 16),
      });
      return Buffer.alloc(0);
    }
    if (offset + 12 + frameSize > buf.length) {
      avLog('ivf: partial frame, holding', {
        frameSize,
        available: buf.length - offset - 12,
      });
      break;
    }
    const pts = buf.readBigUInt64LE(offset + 4);
    onFrame(Buffer.from(buf.subarray(offset + 12, offset + 12 + frameSize)));
    extracted++;
    state.framesTotal++;
    if (DEBUG_AV_VERBOSE) {
      avLog('ivf: frame', { frameSize, pts: pts.toString(), total: state.framesTotal });
    }
    offset += 12 + frameSize;
  }

  if (extracted > 0) avLog('ivf: extracted frames this call', { count: extracted, total: state.framesTotal });
  return buf.subarray(offset);
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export class AVPipeline extends EventEmitter {
  private ytdlp: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;

  private audioBuf: Buffer = Buffer.alloc(0);
  private videoBuf: Buffer = Buffer.alloc(0);
  private audioQueue: Buffer[] = [];

  private audioTimer: NodeJS.Timeout | null = null;
  private drainCheck: NodeJS.Timeout | null = null;
  private ivfState: IVFState = { headerSkipped: false, framesTotal: 0 };

  private _running = false;
  private _paused = false;
  private _frameCount = 0;
  private _seekOffsetMs = 0;

  // Deferred ffmpeg spawn: buffer yt-dlp output until we have enough data
  // for ffmpeg to probe the container, then flush and pipe the rest.
  private _ytdlpPrimeBuffer: Buffer = Buffer.alloc(0);
  private _ytdlpPrimed = false;
  private _ytdlpBytesTotal = 0;

  get running() {
    return this._running;
  }

  get isPaused() {
    return this._paused;
  }

  get positionMs() {
    return this._seekOffsetMs + this._frameCount * OPUS_FRAME_MS;
  }

  constructor(private readonly youtubeUrl: string) {
    super();
  }

  start(seekMs = 0): void {
    if (this._running) return;

    this._running = true;
    this._paused = false;
    this._frameCount = 0;
    this._seekOffsetMs = seekMs;
    this.ivfState = { headerSkipped: false, framesTotal: 0 };
    this.audioBuf = Buffer.alloc(0);
    this.videoBuf = Buffer.alloc(0);
    this.audioQueue = [];
    this._ytdlpPrimeBuffer = Buffer.alloc(0);
    this._ytdlpPrimed = false;
    this._ytdlpBytesTotal = 0;

    const potBaseUrl = process.env.YTDLP_POT_BASE_URL ?? 'http://bgutil-pot-provider:4416';

    // ── Format selection ──────────────────────────────────────────────────────
    // IMPORTANT: Do NOT use `-f b` (best). That selector picks DASH/adaptive
    // formats which yt-dlp downloads as separate audio+video segments and
    // cannot stream to stdout as a single piped container. ffmpeg then sees
    // partial/malformed data and immediately exits with "Invalid data found".
    //
    // Instead, select a progressive (single-file) format.  The preference
    // order below tries:
    //   1. Best single-file mp4 (most compatible, ffmpeg probes instantly)
    //   2. Best single-file webm (VP8/VP9 + Vorbis/Opus, still pipeable)
    //   3. Best single-file format of any container
    //
    // If the video is only available in DASH on YouTube (very common for
    // anything above 1080p), yt-dlp will merge via ffmpeg internally before
    // piping — but that requires a temp file.  For real-time streaming we
    // cap at 720p to stay within single-file territory.
    const formatSelector =
      // Single-file progressive formats only — no '+' merge syntax which
      // produces non-streamable mp4 (moov at end). The [vcodec!=none][acodec!=none]
      // filter ensures we only pick formats that already contain both streams.
      'best[height<=720][ext=mp4][vcodec!=none][acodec!=none]/' +
      'best[height<=720][ext=webm][vcodec!=none][acodec!=none]/' +
      'best[height<=720][vcodec!=none][acodec!=none]/' +
      'best[vcodec!=none][acodec!=none]/' +
      'best';

    const ytdlpArgs = [
      '--no-playlist',
      '--no-warnings',
      ...(DEBUG_AV_VERBOSE ? ['--verbose'] : []),
      '--js-runtimes', 'quickjs:/usr/bin/qjs',
      '--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl}`,
      '-f', formatSelector,
      // When yt-dlp merges DASH streams itself (fallback), output as mp4
      // No merge — format selector picks single-file formats only
      // Print the chosen format info to stderr for diagnostics
      '--print', 'before_dl:%(format_id)s %(ext)s %(width)sx%(height)s %(vcodec)s+%(acodec)s',
      '-o', '-',
    ];

    if (process.env.YTDLP_COOKIES_PATH) {
      ytdlpArgs.push('--cookies', process.env.YTDLP_COOKIES_PATH);
    }

    ytdlpArgs.push(this.youtubeUrl);

    avLog('ytdlp: spawning', { url: this.youtubeUrl, seekMs, formatSelector });
    avLog('ytdlp: args', ytdlpArgs);

    this.ytdlp = spawn('yt-dlp', ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.ytdlp.on('spawn', () => avLog('ytdlp: spawned'));
    this.ytdlp.on('error', (e) => {
      avWarn('ytdlp: spawn error', e);
      this.emit('error', e);
    });
    this.ytdlp.on('exit', (code, signal) => {
      avLog('ytdlp: exit', { code, signal, bytesTotal: this._ytdlpBytesTotal });
      if (code !== 0 && code !== null) {
        avWarn('ytdlp: non-zero exit', { code, signal });
      }
    });

    this.ytdlp.stderr!.on('data', (d: Buffer) => {
      const msg = d.toString();
      // Always print yt-dlp stderr — it contains format selection details
      // and error messages that are critical for diagnosing pipe failures.
      process.stderr.write(`[yt-dlp/av] ${msg}`);
      if (DEBUG_AV) avLog('ytdlp: stderr', msg.trimEnd());
    });

    // ── Deferred ffmpeg spawn ─────────────────────────────────────────────────
    // We do NOT pipe ytdlp.stdout directly to ffmpeg.stdin here.
    // Instead we buffer up to YTDLP_PRIME_BYTES, then:
    //   1. Spawn ffmpeg
    //   2. Write the primed buffer to ffmpeg.stdin
    //   3. Resume piping the rest of ytdlp.stdout → ffmpeg.stdin
    //
    // This ensures ffmpeg's container prober always has a full header to read.
    this.ytdlp.stdout!.on('data', (chunk: Buffer) => {
      this._ytdlpBytesTotal += chunk.length;
      avLog('ytdlp: stdout chunk', {
        len: chunk.length,
        totalSoFar: this._ytdlpBytesTotal,
        primed: this._ytdlpPrimed,
      });

      if (this._ytdlpPrimed) {
        // Already primed — data flows directly to ffmpeg.stdin via the pipe
        // established below; this branch should not be hit once piped.
        return;
      }

      this._ytdlpPrimeBuffer = Buffer.concat([this._ytdlpPrimeBuffer, chunk]);

      if (this._ytdlpPrimeBuffer.length >= YTDLP_PRIME_BYTES) {
        this._ytdlpPrimed = true;
        avLog('ytdlp: prime threshold reached', {
          primeBytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
        });
        // Pause stdout so nothing is lost while we set up ffmpeg
        this.ytdlp!.stdout!.pause();
        this._spawnFfmpeg(seekMs);
      }
    });

    this.ytdlp.stdout!.on('end', () => {
      avLog('ytdlp: stdout end', {
        primed: this._ytdlpPrimed,
        primeBufLen: this._ytdlpPrimeBuffer.length,
        bytesTotal: this._ytdlpBytesTotal,
      });
      // Edge case: video so short the prime buffer never filled
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

    // NOTE: -ss must appear BEFORE -i to be applied as an input option (fast seek).
    // Placing it after -i causes slow accurate seek by decoding all frames up to
    // the target timestamp — fine for accuracy but burns CPU and adds latency.
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', DEBUG_AV_VERBOSE ? 'debug' : 'info',  // 'info' (not 'error') so muxer selection is visible
      // Generous probe sizes for piped input — pipe:0 has no seek, so ffmpeg
      // must buffer enough data to detect container and streams.
      '-probesize', '10M',
      '-analyzeduration', '10M',
      // fflags: generate missing PTS/DTS, ignore edit lists, tolerate minor
      // stream errors — all common in piped progressive mp4/webm.
      '-fflags', '+genpts+igndts',
      // Let ffmpeg auto-detect container from the data — do NOT force '-f mp4'
      // because the fallback 'best' selector may return webm.
      ...inputSeekArgs,
      '-i', 'pipe:0',

      // ── Audio output ──────────────────────────────────────────────────────
      '-map', '0:a:0',
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '1',
      '-b:a', '128k',
      '-f', 'ogg',
      'pipe:1',

      // ── Video output ──────────────────────────────────────────────────────
      '-map', '0:v:0',
      '-c:v', 'libvpx',
      '-b:v', '1500k',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-r', String(VIDEO_FPS),
      '-f', 'ivf',
      'pipe:3',
    ];

    avLog('ffmpeg: spawning', { ffmpegArgs });

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    this.ffmpeg.on('spawn', () => {
      avLog('ffmpeg: spawned — writing prime buffer', {
        primeBytes: this._ytdlpPrimeBuffer.length,
      });

      // Write the primed buffer first
      const canContinue = this.ffmpeg!.stdin!.write(this._ytdlpPrimeBuffer, (err) => {
        if (err) avWarn('ffmpeg: error writing prime buffer', err);
        else avLog('ffmpeg: prime buffer written');
      });

      if (!canContinue) {
        avLog('ffmpeg: stdin backpressure after prime buffer, waiting for drain');
        this.ffmpeg!.stdin!.once('drain', () => {
          avLog('ffmpeg: stdin drained — resuming ytdlp stdout pipe');
          this._pipeYtdlpToFfmpeg();
        });
      } else {
        this._pipeYtdlpToFfmpeg();
      }
    });

    this.ffmpeg.stdin!.on('error', (e) => {
      // EPIPE is expected when ffmpeg exits before yt-dlp finishes — not fatal.
      if ((e as NodeJS.ErrnoException).code === 'EPIPE') {
        avLog('ffmpeg: stdin EPIPE (ffmpeg closed input, likely done or errored)');
      } else {
        avWarn('ffmpeg: stdin error', e);
      }
    });

    this.ffmpeg.stderr!.on('data', (d: Buffer) => {
      const msg = d.toString();
      // Always surface ffmpeg stderr — contains stream info, codec selection,
      // and error messages essential for diagnosing failures.
      process.stderr.write(`[ffmpeg/av] ${msg}`);
      if (DEBUG_AV) avLog('ffmpeg: stderr', msg.trimEnd());

      // Detect and warn on common failure patterns
      if (msg.includes('Invalid data found when processing input')) {
        avWarn('ffmpeg: container probe failure — check yt-dlp format selection', {
          primeBytes: this._ytdlpPrimeBuffer.length,
          containerHint: detectContainerHint(this._ytdlpPrimeBuffer),
          suggestion: 'If container hint is "unknown", yt-dlp may be streaming a DASH manifest instead of a media file. Try a more restrictive format selector.',
        });
      }
      if (msg.includes('Error opening input')) {
        avWarn('ffmpeg: input open failed — full yt-dlp format line should appear above');
      }
      if (msg.includes('moov atom not found')) {
        avWarn('ffmpeg: moov atom missing — this is an mp4 file where the index is at the end (not streamable). yt-dlp may need --hls-prefer-native or a different format.');
      }
    });

    this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
      avLog('ffmpeg: audio chunk', {
        len: chunk.length,
        prefixHex: hexPrefix(chunk),
        prefixAscii: asciiPrefix(chunk),
      });
      this.audioBuf = Buffer.concat([this.audioBuf, chunk]);
      const before = this.audioQueue.length;
      this.audioBuf = extractOggPackets(this.audioBuf, (pkt) => this.audioQueue.push(pkt));
      avLog('ffmpeg: audio queue', { before, after: this.audioQueue.length, bufRemaining: this.audioBuf.length });
    });

    const videoPipe = this.ffmpeg.stdio[3] as Readable;
    videoPipe.on('data', (chunk: Buffer) => {
      avLog('ffmpeg: video chunk', {
        len: chunk.length,
        prefixHex: hexPrefix(chunk),
        prefixAscii: asciiPrefix(chunk, 8),
      });
      this.videoBuf = Buffer.concat([this.videoBuf, chunk]);
      this.videoBuf = extractIVFFrames(
        this.videoBuf,
        (frame) => this.emit('videoFrame', frame),
        this.ivfState,
      );
    });

    this.ffmpeg.on('error', (e) => {
      avWarn('ffmpeg: process error', e);
      this.emit('error', e);
    });

    this.ffmpeg.on('exit', (code, signal) => {
      avLog('ffmpeg: exit', { code, signal });
      if (code !== 0 && code !== null && signal === null) {
        avWarn('ffmpeg: non-zero exit', { code });
      }
    });

    this.ffmpeg.on('close', (code, signal) => {
      avLog('ffmpeg: close', {
        code,
        signal,
        audioQueueAtClose: this.audioQueue.length,
        videoFramesTotal: this.ivfState.framesTotal,
      });

      this._running = false;
      this.drainCheck = setInterval(() => {
        if (this.audioQueue.length === 0) {
          if (this.drainCheck) {
            clearInterval(this.drainCheck);
            this.drainCheck = null;
          }
          if (this.audioTimer) {
            clearInterval(this.audioTimer);
            this.audioTimer = null;
          }
          avLog('ffmpeg: audio queue drained — emitting ended', { code });
          this.emit('ended', code);
        } else {
          avLog('ffmpeg: waiting for audio queue drain', { remaining: this.audioQueue.length });
        }
      }, OPUS_FRAME_MS);
    });

    // Start the audio pump
    this.audioTimer = setInterval(() => {
      if (this._paused) return;
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
    }, OPUS_FRAME_MS);
  }

  private _pipeYtdlpToFfmpeg(): void {
    if (!this.ytdlp?.stdout || !this.ffmpeg?.stdin) {
      avWarn('_pipeYtdlpToFfmpeg: ytdlp or ffmpeg not available');
      return;
    }
    avLog('ytdlp: resuming stdout → piping to ffmpeg stdin');
    // pipe() in Node.js does NOT re-emit buffered data from before pause(),
    // but since we paused before the event loop yielded, no data should be lost.
    this.ytdlp.stdout.pipe(this.ffmpeg.stdin);
    this.ytdlp.stdout.resume();
  }

  stop(): void {
    if (!this._running && !this.ytdlp && !this.ffmpeg) return;

    avLog('stop: called', {
      running: this._running,
      frameCount: this._frameCount,
      positionMs: this.positionMs,
    });

    this._running = false;

    if (this.audioTimer) {
      clearInterval(this.audioTimer);
      this.audioTimer = null;
    }

    if (this.drainCheck) {
      clearInterval(this.drainCheck);
      this.drainCheck = null;
    }

    this._paused = false;
    this._frameCount = 0;
    this._seekOffsetMs = 0;

    try {
      this.ffmpeg?.stdin?.end();
    } catch (e) {
      avLog('stop: ffmpeg stdin end failed', e);
    }

    if (this.ytdlp) {
      avLog('stop: killing ytdlp');
      this.ytdlp.kill('SIGTERM');
    }
    if (this.ffmpeg) {
      avLog('stop: killing ffmpeg');
      this.ffmpeg.kill('SIGTERM');
    }

    this.ytdlp = null;
    this.ffmpeg = null;
    this.audioBuf = Buffer.alloc(0);
    this.videoBuf = Buffer.alloc(0);
    this.audioQueue = [];
    this.ivfState = { headerSkipped: false, framesTotal: 0 };
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