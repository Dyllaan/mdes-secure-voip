import UserHandler from '../../handlers/UserHandler';
import { createMockSocket } from '../helpers/createMockSocket';
import config from '../../config';

const cfg = config.services.realtime;

function makeRoomManager(overrides: { joinRoom?: jest.Mock; leaveRoom?: jest.Mock; updateUserAlias?: jest.Mock } = {}) {
  return {
    rooms: new Map(),
    users: new Map(),
    createRoom: jest.fn().mockImplementation(function(this: any, roomId: string, createdBy: string) {
      this.rooms.set(roomId, { id: roomId, users: new Map(), createdBy, createdAt: Date.now() });
    }),
    joinRoom: overrides.joinRoom ?? jest.fn().mockResolvedValue(true),
    leaveRoom: overrides.leaveRoom ?? jest.fn(),
    updateUserAlias: overrides.updateUserAlias ?? jest.fn(),
    broadcastRoomList: jest.fn(),
  };
}

function makeHandler(overrides: {
  roomManager?: any;
  io?: any;
} = {}) {
  const io = overrides.io ?? { sockets: { sockets: new Map() }, emit: jest.fn() };
  const parent = {
    config: cfg,
    roomManager: overrides.roomManager ?? makeRoomManager(),
    io,
  };
  return { handler: new UserHandler(parent as any), parent };
}

describe('UserHandler', () => {
  describe('handleJoinRoom', () => {
    it('should emit join-error "Invalid room ID" when roomId is missing', async () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      await handler.handleJoinRoom(socket as any, { roomId: '', alias: 'Alice' });
      expect(socket.emit).toHaveBeenCalledWith('join-error', { message: 'Invalid room ID' });
    });

    it('should emit join-error "Invalid room ID" when roomId contains spaces', async () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      await handler.handleJoinRoom(socket as any, { roomId: 'bad room', alias: 'Alice' });
      expect(socket.emit).toHaveBeenCalledWith('join-error', { message: 'Invalid room ID' });
    });

    it('should emit join-error "Invalid room ID" when roomId exceeds maxRoomIdLength', async () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      await handler.handleJoinRoom(socket as any, { roomId: 'a'.repeat(cfg.security.maxRoomIdLength + 1), alias: 'Alice' });
      expect(socket.emit).toHaveBeenCalledWith('join-error', { message: 'Invalid room ID' });
    });

    it('should emit join-error "Invalid alias" when alias is missing', async () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      await handler.handleJoinRoom(socket as any, { roomId: 'room1', alias: '' });
      expect(socket.emit).toHaveBeenCalledWith('join-error', { message: 'Invalid alias' });
    });

    it('should emit join-error "Invalid alias" when alias exceeds maxAliasLength', async () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      await handler.handleJoinRoom(socket as any, { roomId: 'room1', alias: 'a'.repeat(cfg.security.maxAliasLength + 1) });
      expect(socket.emit).toHaveBeenCalledWith('join-error', { message: 'Invalid alias' });
    });

    it('should call leaveRoom when socket is already in a different room', async () => {
      const socket = createMockSocket({ roomId: 'old-room' });
      const roomManager = makeRoomManager();
      roomManager.rooms.set('old-room', { id: 'old-room', users: new Map(), createdBy: 'x', createdAt: 0 } as any);
      const { handler } = makeHandler({ roomManager });
      await handler.handleJoinRoom(socket as any, { roomId: 'new-room', alias: 'Alice' });
      expect(roomManager.leaveRoom).toHaveBeenCalledWith(socket, 'old-room');
    });

    it('should call roomManager.createRoom when room does not already exist', async () => {
      const socket = createMockSocket();
      const roomManager = makeRoomManager();
      const { handler } = makeHandler({ roomManager });
      await handler.handleJoinRoom(socket as any, { roomId: 'brand-new-room', alias: 'Alice' });
      expect(roomManager.createRoom).toHaveBeenCalledWith('brand-new-room', socket.username);
    });

    it('should emit join-error and return when roomManager.joinRoom returns false', async () => {
      const socket = createMockSocket();
      const roomManager = makeRoomManager({ joinRoom: jest.fn().mockResolvedValue(false) });
      const { handler } = makeHandler({ roomManager });
      const result = await handler.handleJoinRoom(socket as any, { roomId: 'room1', alias: 'Alice' });
      expect(result).toBeUndefined();
    });

    it('should emit all-users to the joiner and user-connected to the room on success', async () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001', username: 'alice' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const roomManager = makeRoomManager();
      const { handler } = makeHandler({ roomManager });
      await handler.handleJoinRoom(socket as any, { roomId: 'room1', alias: 'Alice' });
      expect(socket.emit).toHaveBeenCalledWith('all-users', expect.any(Array));
      expect(toReturn.emit).toHaveBeenCalledWith('user-connected', expect.objectContaining({
        peerId: socket.peerId,
        userId: socket.userId,
      }));
    });

    it('should sanitize alias before using it', async () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const { handler } = makeHandler();
      await handler.handleJoinRoom(socket as any, { roomId: 'room1', alias: '<script>xss</script>' });
      // The sanitized alias (inner text) should be broadcast, not raw HTML
      const connectedCall = toReturn.emit.mock.calls.find(([e]: [string]) => e === 'user-connected');
      expect(connectedCall?.[1]?.alias).not.toContain('<script>');
    });
  });

  describe('handleUserUpdate', () => {
    it('should emit user-error "Invalid alias" when alias is missing', () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      handler.handleUserUpdate(socket as any, { alias: '' });
      expect(socket.emit).toHaveBeenCalledWith('user-error', { message: 'Invalid alias' });
    });

    it('should emit user-error "Invalid alias" when alias exceeds maxAliasLength', () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      handler.handleUserUpdate(socket as any, { alias: 'a'.repeat(cfg.security.maxAliasLength + 1) });
      expect(socket.emit).toHaveBeenCalledWith('user-error', { message: 'Invalid alias' });
    });

    it('should call roomManager.updateUserAlias with socket.id and sanitized alias', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const roomManager = makeRoomManager();
      (roomManager.updateUserAlias as jest.Mock).mockReturnValue({ roomId: 'room1', peerId: 'peer-001', alias: 'NewAlias' });
      const { handler } = makeHandler({ roomManager });
      handler.handleUserUpdate(socket as any, { alias: 'NewAlias' });
      expect(roomManager.updateUserAlias).toHaveBeenCalledWith('socket-001', 'NewAlias');
    });

    it('should do nothing if updateUserAlias returns null (user not found)', () => {
      const socket = createMockSocket();
      const roomManager = makeRoomManager();
      (roomManager.updateUserAlias as jest.Mock).mockReturnValue(null);
      const { handler } = makeHandler({ roomManager });
      handler.handleUserUpdate(socket as any, { alias: 'NewAlias' });
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('should emit user-updated to the room with peerId and sanitized alias', () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ id: 'socket-001' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const roomManager = makeRoomManager();
      (roomManager.updateUserAlias as jest.Mock).mockReturnValue({ roomId: 'room1', peerId: 'peer-001', alias: 'NewAlias' });
      const { handler } = makeHandler({ roomManager });
      handler.handleUserUpdate(socket as any, { alias: 'NewAlias' });
      expect(toReturn.emit).toHaveBeenCalledWith('user-updated', { peerId: 'peer-001', alias: 'NewAlias' });
    });
  });

  describe('handleScreenshareStarted', () => {
    it('should do nothing when socket has no roomId', () => {
      const socket = createMockSocket({ roomId: undefined });
      const { handler } = makeHandler();
      expect(() => handler.handleScreenshareStarted(socket as any, { screenPeerId: 'screen-001' })).not.toThrow();
    });

    it('should add socket to activeScreenShares and broadcast peer-screenshare-started', () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ id: 'socket-001', roomId: 'room1', peerId: 'peer-001' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const roomManager = makeRoomManager();
      const room = { id: 'room1', users: new Map(), createdBy: 'user-001', createdAt: Date.now() } as any;
      roomManager.rooms.set('room1', room);
      const { handler } = makeHandler({ roomManager });

      handler.handleScreenshareStarted(socket as any, { screenPeerId: 'screen-peer-001' });
      expect(room.activeScreenShares?.has('peer-001')).toBe(true);
      expect(toReturn.emit).toHaveBeenCalledWith('peer-screenshare-started', expect.objectContaining({
        peerId: 'peer-001',
        screenPeerId: 'screen-peer-001',
      }));
    });

    it('should emit room-screen-peers to the sharer', () => {
      const socket = createMockSocket({ id: 'socket-001', roomId: 'room1', peerId: 'peer-001' });
      const roomManager = makeRoomManager();
      const room = { id: 'room1', users: new Map(), createdBy: 'user-001', createdAt: Date.now() } as any;
      roomManager.rooms.set('room1', room);
      const { handler } = makeHandler({ roomManager });
      handler.handleScreenshareStarted(socket as any, { screenPeerId: 'screen-peer-001' });
      expect(socket.emit).toHaveBeenCalledWith('room-screen-peers', { peers: [] });
    });
  });

  describe('handleScreenshareStopped', () => {
    it('should do nothing when socket has no roomId', () => {
      const socket = createMockSocket({ roomId: undefined });
      const { handler } = makeHandler();
      expect(() => handler.handleScreenshareStopped(socket as any)).not.toThrow();
    });

    it('should delete socket from activeScreenShares and broadcast peer-screenshare-stopped', () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ id: 'socket-001', roomId: 'room1', peerId: 'peer-001' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const roomManager = makeRoomManager();
      const activeScreenShares = new Map([['peer-001', { peerId: 'peer-001', alias: 'Alice', screenPeerId: 'screen-001' }]]);
      const room = { id: 'room1', users: new Map(), createdBy: 'user-001', createdAt: Date.now(), activeScreenShares } as any;
      roomManager.rooms.set('room1', room);
      const { handler } = makeHandler({ roomManager });

      handler.handleScreenshareStopped(socket as any);
      expect(activeScreenShares.has('peer-001')).toBe(false);
      expect(toReturn.emit).toHaveBeenCalledWith('peer-screenshare-stopped', { peerId: 'peer-001' });
    });
  });
});
