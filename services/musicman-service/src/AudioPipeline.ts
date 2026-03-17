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
 * AudioPipeline manages a yt-dlp | ffmpeg subprocess pipeline to extract Opus audio frames from a YouTube URL
 * It emits 'frame' events with OpusFrame data, and an 'ended' event when the stream finishes.
 */
export class AudioPipeline extends EventEmitter {
  private ytdlp:  ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private buf:    Buffer              = Buffer.alloc(0);
  private timer:  NodeJS.Timeout | null = null;
  private queue:  Buffer[]            = [];
  private _running = false;

  get running() { return this._running; }

  constructor(private readonly youtubeUrl: string) {
    super();
  }

  start(): void {
    if (this._running) return;
    this._running = true;

    console.log('[AudioPipeline] Starting yt-dlp | ffmpeg pipeline');

    this.ytdlp = spawn('yt-dlp', [
      '--no-playlist',
      '--no-warnings',
      '-f', '251',
      '-o', '-',
      this.youtubeUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    this.ffmpeg = spawn('ffmpeg', [
      '-loglevel',       'error',
      '-probesize',      '10M',
      '-analyzeduration','10M',
      '-i',              'pipe:0',
      '-vn',
      '-c:a',            'libopus',
      '-ar',             '48000',
      '-ac',             '1',
      '-b:a',            '128k',
      '-f',              'ogg',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

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

    /** Suppress "Error parsing Opus packet header"
    // does not affect output */
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
      const exitCode = code;
      const drainCheck = setInterval(() => {
        if (this.queue.length === 0) {
          clearInterval(drainCheck);
          if (this.timer) { clearInterval(this.timer); this.timer = null; }
          this.emit('ended', exitCode);
        }
      }, OPUS_FRAME_MS);
    });

    this.timer = setInterval(() => {
      if (this.queue.length > 0) {
        const frame = this.queue.shift()!;
        this.emit('frame', { data: frame, durationMs: OPUS_FRAME_MS } satisfies OpusFrame);
      }
    }, OPUS_FRAME_MS);
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    try { this.ffmpeg?.stdin?.end(); } catch { /* already closed */ }
    this.ytdlp?.kill('SIGTERM');
    this.ffmpeg?.kill('SIGTERM');

    this.ytdlp  = null;
    this.ffmpeg = null;
    this.buf    = Buffer.alloc(0);
    this.queue  = [];
  }
}