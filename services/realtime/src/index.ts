import config from './config';
import SecureRealtimeService from './SecureRealtimeService';

async function start(): Promise<void> {
    try {
        console.log('Starting Secure Realtime Service...');
        const service = new SecureRealtimeService();
        await service.start();

        const protocol = config.services.realtime.NODE_ENV === 'production' ? 'wss' : 'ws';
        const { port: realtimePort, peerPort } = config.services.realtime;

        console.log('Service started successfully');
        console.log(` Socket.IO server: ${protocol}://localhost:${realtimePort}`);
        console.log(` PeerJS server: ${protocol}://localhost:${peerPort}`);
        console.log(` Health check: http://localhost:${realtimePort}/health`);
    } catch (error) {
        console.error('Failed to start service:', error);
        process.exit(1);
    }
}

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    setTimeout(() => {
        console.log('Shutdown complete');
        process.exit(0);
    }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();