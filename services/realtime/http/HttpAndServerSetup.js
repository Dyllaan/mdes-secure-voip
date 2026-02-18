const express = require('express');
const http = require('http');
const https = require('https');
const socketIO = require('socket.io');
const { PeerServer } = require('peer');
const crypto = require('crypto');
const fs = require('fs');
const setupMiddleware = require('../middleware/middleware');
const setupRoutes = require('../routes');

class HttpAndServerSetup {
    constructor(service) {
        this.service = service;
        this.config = service.config;

        this.app = express();
        this.server = this._createServer();

        this.io = socketIO(this.server, {
            cors: this.config.cors,
            pingTimeout: 60000,
            pingInterval: 25000
        });

        this.peerServer = PeerServer({
            port: this.config.peerPort,
            path: '/peerjs',
            allow_discovery: false,
            proxied: true,
            corsOptions: this.config.cors,
            key: 'peerjs',
            generateClientId: () => crypto.randomBytes(16).toString('hex')
        });
    }

    _createServer() {
        if (process.env.NODE_ENV === 'production' &&
            process.env.SSL_KEY_PATH &&
            process.env.SSL_CERT_PATH) {
            try {
                const options = {
                    key: fs.readFileSync(process.env.SSL_KEY_PATH),
                    cert: fs.readFileSync(process.env.SSL_CERT_PATH)
                };
                console.log('HTTPS server enabled');
                return https.createServer(options, this.app);
            } catch (error) {
                console.warn('Failed to load SSL certificates, falling back to HTTP:', error.message);
            }
        }
        return http.createServer(this.app);
    }

    initialize(socketHandlers) {
        setupMiddleware(this.app, this.config);
        setupRoutes(this.app, this.config, socketHandlers);
    }

    start() {
        return new Promise((resolve) => {
            this.server.listen(this.config.port, () => {
                console.log(`Secure Realtime service running on port ${this.config.port}`);
                console.log(`PeerJS server running on port ${this.config.peerPort}`);
                console.log(`Security features: JWT, Rate Limiting, Helmet, CORS, Signal Protocol E2E`);
                resolve();
            });
        });
    }

    shutdown() {
        console.log('Shutting down server...');
        this.io.emit('server-shutdown', { message: 'Server is shutting down for maintenance' });
        this.io.close(() => console.log('Socket.IO server closed'));
        this.server.close(() => console.log('HTTP/HTTPS server closed'));
    }
}

module.exports = HttpAndServerSetup;