const { Innertube } = require('youtubei.js');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const EventEmitter = require('events');

class AudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.currentStream = null;
    this.ffmpegCommand = null;
    this.isPaused = false;
    this.youtube = null;
  }

  async initialize() {
    if (!this.youtube) {
      this.youtube = await Innertube.create();
      console.log('✓ YouTube client initialized');
    }
  }

  async play(url) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.initialize();
        
        console.log(`Playing URL: ${url}`);
        
        // Extract video ID
        const videoId = url.match(/(?:v=|\/)([\w-]{11})/)?.[1];
        if (!videoId) {
          throw new Error('Invalid YouTube URL');
        }

        const info = await this.youtube.getInfo(videoId);
        console.log(`Playing: ${info.basic_info.title}`);

        // Get audio stream
        const format = info.chooseFormat({ type: 'audio', quality: 'best' });
        const audioStream = await info.download({ type: 'audio', quality: 'best', format: 'opus' });

        const outputStream = new PassThrough();

        this.ffmpegCommand = ffmpeg(audioStream)
          .audioFrequency(48000)
          .audioChannels(2)
          .audioCodec('pcm_s16le')
          .format('s16le')
          .on('error', (err) => {
            console.error('FFmpeg error:', err);
            this.cleanup();
            reject(err);
          })
          .on('end', () => {
            this.cleanup();
            this.emit('end');
            resolve();
          });

        this.ffmpegCommand.pipe(outputStream);

        const CHUNK_SIZE = 4096;
        let buffer = Buffer.alloc(0);

        outputStream.on('data', (chunk) => {
          if (this.isPaused) return;
          buffer = Buffer.concat([buffer, chunk]);

          while (buffer.length >= CHUNK_SIZE) {
            const audioChunk = buffer.slice(0, CHUNK_SIZE);
            buffer = buffer.slice(CHUNK_SIZE);
            this.emit('data', Array.from(audioChunk));
          }
        });

        outputStream.on('end', () => {
          if (buffer.length > 0 && !this.isPaused) {
            this.emit('data', Array.from(buffer));
          }
        });

        this.currentStream = outputStream;

      } catch (err) {
        this.cleanup();
        reject(err);
      }
    });
  }

  stop() {
    this.cleanup();
    this.emit('end');
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  cleanup() {
    if (this.ffmpegCommand) {
      try {
        this.ffmpegCommand.kill('SIGKILL');
      } catch (err) {}
      this.ffmpegCommand = null;
    }
    if (this.currentStream) {
      try {
        this.currentStream.destroy();
      } catch (err) {}
      this.currentStream = null;
    }
    this.isPaused = false;
  }
}

module.exports = AudioPlayer;