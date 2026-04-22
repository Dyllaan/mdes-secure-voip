import { Request, Response, NextFunction, Application, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { isValidRoomId } from './utils/validate';
import { generateRoomId } from './utils/roomId';
import { RealtimeConfig } from './config';
import { SocketHandlers, Room } from './types';
import { verifyAccessToken } from './auth/verifyAccessToken';

interface AuthenticatedRequest extends Request {
    userId?: string;
}

function setupRoutes(app: Application, config: RealtimeConfig, socketHandlers: SocketHandlers): void {
    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'healthy' });
    });

    app.use('/api', authenticateRequest(config));

    app.get('/api/rooms', (_req: Request, res: Response) => {
        const rooms = Array.from(socketHandlers.roomManager.rooms.entries() as Iterable<[string, Room]>)
            .map(([id, room]) => ({ id, userCount: room.users.size }));
        res.json({ rooms });
    });

    app.post('/api/rooms', (req: AuthenticatedRequest, res: Response) => {
        const { roomId } = req.body as { roomId?: string };
        const userId = req.userId!;

        if (roomId && !isValidRoomId(roomId, config.security.maxRoomIdLength)) {
            res.status(400).json({ error: 'Invalid room ID format' });
            return;
        }

        const finalRoomId = roomId ?? generateRoomId();

        if (!socketHandlers.roomManager.rooms.has(finalRoomId)) {
            socketHandlers.roomManager.createRoom(finalRoomId, userId);
            res.json({ roomId: finalRoomId, created: true });
        } else {
            res.json({ roomId: finalRoomId, created: false });
        }
    });

    app.delete('/api/rooms/:roomId', (req: AuthenticatedRequest, res: Response) => {
        const { roomId } = req.params;
        const userId = req.userId!;
        const room = socketHandlers.roomManager.rooms.get(roomId);

        if (!room) {
            res.status(404).json({ error: 'Room not found' });
            return;
        }

        if (room.createdBy !== userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        socketHandlers.io.to(roomId).emit('room-closed', { message: 'Room has been closed by host' });
        socketHandlers.roomManager.rooms.delete(roomId);
        res.json({ success: true });
    });

    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error('Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    });
}

function authenticateRequest(config: RealtimeConfig): RequestHandler {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        const token = authHeader.substring(7);

        try {
            const decoded = verifyAccessToken(token, config);
            req.userId = decoded.sub;
            next();
        } catch (err) {
            if (err instanceof jwt.TokenExpiredError) {
                res.status(401).json({ error: 'Token expired' });
                return;
            }
            res.status(401).json({ error: 'Invalid token' });
        }
    };
}

export default setupRoutes;
