/**
 * Core HTTP and WebSocket server setup for the Realtime service.
 */
import express, { Application } from 'express';
import http from 'http';
import https from 'https';
import { Server as SocketIOServer, ServerOptions } from 'socket.io';
import { PeerServer } from 'peer';
import crypto from 'crypto';
import fs from 'fs';
import setupMiddleware from '../middleware/middleware';
import setupRoutes from '../routes';
import type { CorsOptions } from 'cors';
import { RealtimeConfig } from '../config';
import { Service, SocketHandlers } from '../types';

class HttpAndServerSetup {
    private service: Service;
    private config: RealtimeConfig;
    app: Application;
    server: http.Server | https.Server;
    io: SocketIOServer;
    peerServer: ReturnType<typeof PeerServer>;

    constructor(service: Service) {
        this.service = service;
        this.config = service.config;
        this.app = express();
        this.server = this._createServer();
        this.io = new SocketIOServer(this.server, {
            cors: this.config.cors,
            pingTimeout: 60000,
            pingInterval: 25000
        });
        this.peerServer = PeerServer({
            port: this.config.peerPort,
            path: '/peerjs',
            allow_discovery: false,
            proxied: true,
            corsOptions: this.config.cors as CorsOptions,
            key: 'peerjs',
            generateClientId: () => crypto.randomBytes(16).toString('hex')
        });
    }

    private _createServer(): http.Server | https.Server {
        if (
            this.config.NODE_ENV === 'production' &&
            this.config.sslKeyPath &&
            this.config.sslCertPath
        ) {
            try {
                const options: https.ServerOptions = {
                    key: fs.readFileSync(this.config.sslKeyPath),
                    cert: fs.readFileSync(this.config.sslCertPath)
                };
                console.log('HTTPS server enabled');
                return https.createServer(options, this.app);
            } catch (error) {
                console.warn('Failed to load SSL certificates, falling back to HTTP:', (error as Error).message);
            }
        }
        return http.createServer(this.app);
    }

    initialize(socketHandlers: SocketHandlers): void {
        setupMiddleware(this.app, this.config);
        setupRoutes(this.app, this.config, socketHandlers);
    }

    start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(this.config.port, () => {
                console.log(`Secure Realtime service running on port ${this.config.port}`);
                console.log(`PeerJS server running on port ${this.config.peerPort}`);
                console.log(`Security features: JWT, Rate Limiting, Helmet, CORS, Signal Protocol E2E`);
                resolve();
            });
        });
    }

    shutdown(): void {
        console.log('Shutting down server...');
        this.io.emit('server-shutdown', { message: 'Server is shutting down for maintenance' });
        this.io.close(() => console.log('Socket.IO server closed'));
        this.server.close(() => console.log('HTTP/HTTPS server closed'));
    }
}

export default HttpAndServerSetup;