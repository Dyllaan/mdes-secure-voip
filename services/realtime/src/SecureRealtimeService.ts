import 'dotenv/config';
import config from './config';
import HttpAndServerSetup from './http/HttpAndServerSetup';
import SocketEventHandlers from './handlers/SocketEventHandlers';
import { Server as SocketIOServer } from 'socket.io';
import { RealtimeConfig } from './config';
import http from 'http';
import https from 'https';

class SecureRealtimeService {
    config: RealtimeConfig;
    httpSetup: HttpAndServerSetup;
    server: http.Server | https.Server;
    io: SocketIOServer;
    socketHandlers: SocketEventHandlers;

    constructor() {
        this.config = config.services.realtime;
        this.httpSetup = new HttpAndServerSetup(this);
        this.server = this.httpSetup.server;
        this.io = this.httpSetup.io;
        this.socketHandlers = new SocketEventHandlers(this);
    }

    start(): Promise<void> {
        this.socketHandlers.setup();
        this.socketHandlers.startCleanupInterval();
        this.httpSetup.initialize(this.socketHandlers);
        return this.httpSetup.start();
    }

    shutdown(): void {
        this.httpSetup.shutdown();
    }
}

export default SecureRealtimeService;