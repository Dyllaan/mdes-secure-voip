const AuthManager = require('./AuthManager');
const AudioPlayer = require('./AudioPlayer');
const Queue = require('./Queue');

class MusicBot {
  constructor(config, io) {
    this.config = config;
    this.io = io;
    this.audioPlayer = new AudioPlayer();
    this.queue = new Queue();
    this.isPlaying = false;
    this.authManager = new AuthManager(config.auth);
    this.connectedClients = new Set();
  }

  async initialize() {
    // Authenticate
    try {
      await this.authManager.login();
    } catch (error) {
      console.error('Failed to authenticate, cannot start music bot');
      throw error;
    }

    // Setup Socket.IO event handlers
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      this.connectedClients.add(socket.id);

      // Send current state to new client
      socket.emit('queue_update', {
        queue: this.queue.getAll(),
        nowPlaying: this.queue.getNowPlaying(),
        isPlaying: this.isPlaying
      });

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });
    });

    // Audio player events
    this.audioPlayer.on('data', (audioChunk) => {
      this.io.emit('audio', audioChunk);
    });

    this.audioPlayer.on('end', () => {
      this.isPlaying = false;
      this.processQueue();
    });

    this.audioPlayer.on('error', (err) => {
      console.error('Audio player error:', err);
      this.isPlaying = false;
      this.processQueue();
    });

    console.log('✓ Music bot initialized');
  }

  async addToQueue(url, addedBy = 'system') {
    const song = await this.queue.add(url, addedBy);
    this.broadcastQueueUpdate();
    
    if (!this.isPlaying) {
      this.processQueue();
    }
    
    return song;
  }

  async processQueue() {
    if (this.isPlaying || this.queue.isEmpty()) return;

    const song = this.queue.getNext();
    if (!song) return;

    console.log(`Now playing: ${song.title}`);
    this.isPlaying = true;
    
    this.broadcastNowPlaying(song);
    
    try {
      await this.audioPlayer.play(song.url);
    } catch (err) {
      console.error('Error playing song:', err);
      this.isPlaying = false;
      this.processQueue();
    }
  }

  skip() {
    if (this.isPlaying) {
      this.audioPlayer.stop();
      this.isPlaying = false;
      this.processQueue();
    }
  }

  pause() {
    this.audioPlayer.pause();
    this.io.emit('playback_state', { state: 'paused' });
  }

  resume() {
    this.audioPlayer.resume();
    this.io.emit('playback_state', { state: 'playing' });
  }

  clearQueue() {
    this.queue.clear();
    this.broadcastQueueUpdate();
  }

  broadcastQueueUpdate() {
    this.io.emit('queue_update', {
      queue: this.queue.getAll(),
      nowPlaying: this.queue.getNowPlaying(),
      isPlaying: this.isPlaying
    });
  }

  broadcastNowPlaying(song) {
    this.io.emit('now_playing', { song });
  }

  getConnectedClients() {
    return Array.from(this.connectedClients);
  }

  getQueueInfo() {
    return {
      songs: this.queue.getAll(),
      nowPlaying: this.queue.getNowPlaying(),
      isPlaying: this.isPlaying
    };
  }

  async disconnect() {
    if (this.audioPlayer) this.audioPlayer.stop();
    if (this.authManager) await this.authManager.logout();
  }
}
module.exports = MusicBot;