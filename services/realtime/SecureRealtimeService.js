require('dotenv').config();
const config = require('./config');
const HttpAndServerSetup = require('./http/HttpAndServerSetup');
const SocketEventHandlers = require('./handlers/SocketEventHandlers');

class SecureRealtimeService {
    constructor() {
        this.config = config.services.realtime;
        this.httpSetup = new HttpAndServerSetup(this);
        this.server = this.httpSetup.server;
        this.io = this.httpSetup.io;
        this.socketHandlers = new SocketEventHandlers(this);
    }

    start() {
        this.socketHandlers.setup();
        this.socketHandlers.startCleanupInterval();
        this.httpSetup.initialize(this.socketHandlers);
        return this.httpSetup.start();
    }

    shutdown() {
        this.httpSetup.shutdown();
    }
}

module.exports = SecureRealtimeService;