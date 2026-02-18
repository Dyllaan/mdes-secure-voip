
require('dotenv').config();
const SecureRealtimeService = require('./SecureRealtimeService');

// Start the service if this file is run directly
if (require.main === module) {
  async function start() {
    try {
      console.log(' Starting Secure Real-time Communications Service...');
      console.log(' Signal Protocol E2E Encryption Enabled');
      
      const service = new SecureRealtimeService();
      await service.start();
      
      console.log('Service started successfully!');
      console.log(` Socket.IO server: ${process.env.NODE_ENV === 'production' ? 'wss' : 'ws'}://localhost:${process.env.REALTIME_PORT || 3001}`);
      console.log(` PeerJS server: ${process.env.NODE_ENV === 'production' ? 'wss' : 'ws'}://localhost:${process.env.PEER_PORT || 9000}`);
      console.log(` Health check: http://localhost:${process.env.REALTIME_PORT || 3001}/health`);
      
    } catch (error) {
      console.error('Failed to start service:', error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  let isShuttingDown = false;
  
  const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n Received ${signal}, shutting down gracefully...`);
    
    // Give connections time to close
    setTimeout(() => {
      console.log('Shutdown complete');
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  start();
}