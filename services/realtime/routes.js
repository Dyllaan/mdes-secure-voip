const jwt = require('jsonwebtoken');
const { isValidRoomId } = require('./utils/validate');
const { generateRoomId } = require('./utils/roomId');

function setupRoutes(app, config, socketHandlers) {
    // Health check (no auth required)
    app.get('/health', (req, res) => {
        const { roomManager, signalKeys, messageQueues } = socketHandlers;
        res.json({
            status: 'healthy',
            services: ['signaling', 'voip', 'encrypted-chat'],
            activeRooms: roomManager.rooms.size,
            activeUsers: roomManager.users.size,
            signalKeysRegistered: signalKeys.size,
            queuedMessages: Array.from(messageQueues.values()).reduce((sum, q) => sum + q.length, 0),
            timestamp: new Date().toISOString()
        });
    });

    // All routes below require auth
    app.use('/api', authenticateRequest(config));

    // Room management
    app.get('/api/rooms', (req, res) => {
        const rooms = Array.from(socketHandlers.roomManager.rooms.entries())
            .map(([id, room]) => ({ id, userCount: room.users.size }));
        res.json({ rooms });
    });

    app.post('/api/rooms', (req, res) => {
        const { roomId } = req.body;
        const userId = req.userId;

        if (roomId && !isValidRoomId(roomId, config.security.maxRoomIdLength)) {
            return res.status(400).json({ error: 'Invalid room ID format' });
        }

        const finalRoomId = roomId || generateRoomId();

        if (!socketHandlers.roomManager.rooms.has(finalRoomId)) {
            socketHandlers.roomManager.createRoom(finalRoomId, userId);
            res.json({ roomId: finalRoomId, created: true });
        } else {
            res.json({ roomId: finalRoomId, created: false });
        }
    });

    app.delete('/api/rooms/:roomId', (req, res) => {
        const { roomId } = req.params;
        const userId = req.userId;

        const room = socketHandlers.roomManager.rooms.get(roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        if (room.createdBy !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        socketHandlers.io.to(roomId).emit('room-closed', { message: 'Room has been closed by host' });
        socketHandlers.roomManager.rooms.delete(roomId);
        res.json({ success: true });
    });

    // Global error handler
    app.use((err, req, res, next) => {
        console.error('Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    });
}

function authenticateRequest(config) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.substring(7);
        try {
            const decoded = jwt.verify(token, config.jwt.secret);
            req.userId = decoded.userId;
            req.username = decoded.username;
            next();
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token expired' });
            }
            return res.status(401).json({ error: 'Invalid token' });
        }
    };
}

module.exports = setupRoutes;