const { Innertube } = require('youtubei.js');

class Queue {
  constructor() {
    this.songs = [];
    this.currentIndex = -1;
    this.nowPlaying = null;
    this.youtube = null;
  }

  async initialize() {
    if (!this.youtube) {
      this.youtube = await Innertube.create();
    }
  }

  async add(url, addedBy = 'system') {
    await this.initialize();

    // Basic YouTube URL validation
    const videoId = url.match(/(?:v=|\/)([\w-]{11})/)?.[1];
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    try {
      const info = await this.youtube.getInfo(videoId);
      
      const song = {
        id: Date.now().toString(),
        url: url,
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        thumbnail: info.basic_info.thumbnail?.[0]?.url || null,
        addedBy: addedBy,
        addedAt: new Date().toISOString()
      };

      this.songs.push(song);
      return song;
    } catch (error) {
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }

  getNext() {
    if (this.isEmpty()) return null;

    this.currentIndex++;
    
    if (this.currentIndex >= this.songs.length) {
      this.currentIndex = -1;
      this.nowPlaying = null;
      return null;
    }

    this.nowPlaying = this.songs[this.currentIndex];
    return this.nowPlaying;
  }

  remove(songId) {
    const index = this.songs.findIndex(s => s.id === songId);
    if (index !== -1) {
      const removed = this.songs.splice(index, 1)[0];
      
      if (index < this.currentIndex) {
        this.currentIndex--;
      } else if (index === this.currentIndex) {
        this.nowPlaying = null;
      }
      
      return removed;
    }
    return null;
  }

  clear() {
    this.songs = [];
    this.currentIndex = -1;
    this.nowPlaying = null;
  }

  getAll() {
    return this.songs.map((song, index) => ({
      ...song,
      position: index,
      isPlaying: index === this.currentIndex
    }));
  }

  getNowPlaying() {
    return this.nowPlaying;
  }

  isEmpty() {
    return this.songs.length === 0;
  }
}

module.exports = Queue;