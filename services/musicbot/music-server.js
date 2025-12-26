require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const MusicBot = require('./class/MusicBot');

// Configuration
const AUTH_CONFIG = {
  authServiceUrl: process.env.AUTH_SERVICE_URL,
  username: 'MusicBot',
  password: 'Mu51cB0t!@'
};

// ============================================================================
// EXPRESS & SOCKET.IO SERVER
// ============================================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3007;

app.use(cors());
app.use(express.json());

// Initialize music bot
const musicBot = new MusicBot({ auth: AUTH_CONFIG }, io);

// REST API Routes
app.get('/health', async (req, res) => {
  const isAuthenticated = await musicBot.authManager.verifyToken();
  
  res.json({
    status: 'ok',
    bot: {
      authenticated: isAuthenticated,
      connectedClients: musicBot.getConnectedClients().length,
      clients: musicBot.getConnectedClients(),
      queue: musicBot.getQueueInfo()
    }
  });
});

app.get('/api/queue', (req, res) => {
  res.json(musicBot.getQueueInfo());
});

app.post('/api/queue/add', async (req, res) => {
  const { url, addedBy } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const song = await musicBot.addToQueue(url, addedBy || 'api');
    res.json({
      success: true,
      song: song,
      queue: musicBot.getQueueInfo()
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/queue/skip', (req, res) => {
  musicBot.skip();
  res.json({ success: true, queue: musicBot.getQueueInfo() });
});

app.post('/api/queue/pause', (req, res) => {
  musicBot.pause();
  res.json({ success: true, status: 'paused' });
});

app.post('/api/queue/resume', (req, res) => {
  musicBot.resume();
  res.json({ success: true, status: 'playing' });
});

app.delete('/api/queue/clear', (req, res) => {
  musicBot.clearQueue();
  res.json({ success: true, queue: musicBot.getQueueInfo() });
});

app.delete('/api/queue/:songId', (req, res) => {
  const removed = musicBot.queue.remove(req.params.songId);
  
  if (removed) {
    musicBot.broadcastQueueUpdate();
    res.json({ success: true, removed: removed, queue: musicBot.getQueueInfo() });
  } else {
    res.status(404).json({ error: 'Song not found in queue' });
  }
});

// Start server
server.listen(PORT, async () => {
  console.log(`Music bot server listening on port ${PORT}`);
  console.log(`WebSocket server ready for client connections`);
  
  try {
    await musicBot.initialize();
  } catch (error) {
    console.error('Failed to start music bot:', error.message);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await musicBot.disconnect();
  process.exit(0);
});