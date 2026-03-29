import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export const OPUS_FRAME_MS = 20;
export const SAMPLE_RATE = 48_000;
export const CHANNELS = 1;
export const RTP_TIMESTAMP_STEP = SAMPLE_RATE * OPUS_FRAME_MS / 1000;

export interface OpusFrame {
  data:       Buffer;
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

    const headerType  = buf[offset + 5];
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
      let pktLen   = 0;

      for (const seg of segTable) {
        pktLen += seg;
        if (seg < 255) {
          const pkt = buf.subarray(pktStart, pktStart + pktLen);
          const tag = pkt.toString('ascii', 0, Math.min(8, pkt.length));
          if (!tag.startsWith('OpusHead') && !tag.startsWith('OpusTags')) {
            onPacket(Buffer.from(pkt));
          }
          pktStart += pktLen;
          pktLen    = 0;
        }
      }
    }

    offset += pageSize;
  }

  return buf.subarray(offset);
}

/**
 * AudioPipeline manages a yt-dlp | ffmpeg subprocess pipeline to extract Opus audio frames from a YouTube URL.
 * It emits 'frame' events with OpusFrame data, and an 'ended' event when the stream finishes.
 *
 * Supports pause/resume (stops frame dispatch without killing processes) and seek (restarts
 * pipeline from an offset using ffmpeg output seek).
 */
export class AudioPipeline extends EventEmitter {
  private ytdlp:  ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private buf:    Buffer              = Buffer.alloc(0);
  private timer:  NodeJS.Timeout | null = null;
  private queue:  Buffer[]            = [];
  private _running      = false;
  private _paused       = false;
  private _frameCount   = 0;
  private _seekOffsetMs = 0;
  // Stored so stop() can clear it and prevent stale 'ended' emission after seek/changeTrack
  private _drainCheck: NodeJS.Timeout | null = null;

  get running()    { return this._running; }
  get isPaused()   { return this._paused; }
  get positionMs() { return this._seekOffsetMs + this._frameCount * OPUS_FRAME_MS; }

  constructor(private readonly youtubeUrl: string) {
    super();
  }

  start(seekMs = 0): void {
    if (this._running) return;
    this._running      = true;
    this._paused       = false;
    this._frameCount   = 0;
    this._seekOffsetMs = seekMs;

    console.log('[AudioPipeline] Starting yt-dlp | ffmpeg pipeline');

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

    ytdlpArgs.push(this.youtubeUrl);

    this.ytdlp = spawn('yt-dlp', ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    // When seekMs > 0, use output seek (-ss after -i) so it works on non-seekable piped input.
    // This decodes and discards frames up to the seek point — slow for large offsets but correct.
    const ffmpegArgs = [
      '-loglevel',        'error',
      '-probesize',       '32k',
      '-analyzeduration', '0',
      '-i',               'pipe:0',
      ...(seekMs > 0 ? ['-ss', String(seekMs / 1000)] : []),
      '-vn',
      '-c:a',             'libopus',
      '-ar',              '48000',
      '-ac',              '1',
      '-b:a',             '128k',
      '-f',               'ogg',
      'pipe:1',
    ];

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    // Suppress broken pipe errors
    this.ytdlp.stdout!.on('error', () => {});
    this.ffmpeg.stdin!.on('error', () => {});

    this.ytdlp.stdout!.pipe(this.ffmpeg.stdin!);

    this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.buf = extractOggPackets(this.buf, (pkt) => this.queue.push(pkt));
    });

    this.ytdlp.stderr!.on('data', (d: Buffer) =>
      process.stderr.write(`[yt-dlp]  ${d}`));

    /** Suppress "Error parsing Opus packet header" — does not affect output */
    this.ffmpeg.stderr!.on('data', (d: Buffer) => {
      const msg = d.toString();
      if (!msg.includes('Error parsing Opus packet header')) {
        process.stderr.write(`[ffmpeg]  ${msg}`);
      }
    });

    this.ytdlp.on('error', (e) => this.emit('error', e));
    this.ffmpeg.on('error', (e) => this.emit('error', e));

    this.ffmpeg.on('close', (code) => {
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
      if (this._paused) return;   // hold dispatch while paused, keep queue filling
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

    if (this.timer)      { clearInterval(this.timer);      this.timer      = null; }
    if (this._drainCheck){ clearInterval(this._drainCheck); this._drainCheck = null; }

    this._paused       = false;
    this._frameCount   = 0;
    this._seekOffsetMs = 0;

    try { this.ffmpeg?.stdin?.end(); } catch { /* already closed */ }
    this.ytdlp?.kill('SIGTERM');
    this.ffmpeg?.kill('SIGTERM');

    this.ytdlp  = null;
    this.ffmpeg = null;
    this.buf    = Buffer.alloc(0);
    this.queue  = [];
  }

  /** Pause frame dispatch without stopping the underlying yt-dlp/ffmpeg processes. */
  pause(): void {
    if (this._running && !this._paused) this._paused = true;
  }

  /** Resume frame dispatch after a pause(). */
  resume(): void {
    if (this._running && this._paused) this._paused = false;
  }

  /**
   * Seek to a position by restarting the pipeline with an ffmpeg output-seek offset.
   * Seek is approximate for variable-bitrate streams due to output-seek decode overhead.
   */
  seek(ms: number): void {
    this.stop();
    this.start(Math.max(0, ms));
  }
}
