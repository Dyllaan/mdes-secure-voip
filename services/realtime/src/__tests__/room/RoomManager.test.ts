import RoomManager from '../../room/RoomManager';
import { createMockSocket } from '../helpers/createMockSocket';
import config from '../../config';

const mockIo = {
  emit: jest.fn(),
  sockets: { sockets: new Map() },
} as any;

const cfg = config.services.realtime;

let mockFetch: jest.Mock;
beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch as typeof fetch;
  jest.clearAllMocks();
});

function makeManager() {
  return new RoomManager(cfg, mockIo);
}

describe('RoomManager', () => {
  describe('createRoom', () => {
    it('should create a room with the given id and empty users Map', () => {
      const rm = makeManager();
      rm.createRoom('room1', 'user-001');
      const room = rm.rooms.get('room1');
      expect(room).toBeDefined();
      expect(room!.id).toBe('room1');
      expect(room!.createdBy).toBe('user-001');
      expect(room!.users.size).toBe(0);
    });

    it('should overwrite an existing room when called with same roomId', () => {
      const rm = makeManager();
      rm.createRoom('room1', 'user-001');
      rm.createRoom('room1', 'user-002');
      expect(rm.rooms.get('room1')!.createdBy).toBe('user-002');
    });
  });

  describe('joinRoom', () => {
    it('should emit join-error and return false when checkChannelAccess returns false', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: false, status: 403 });
      const socket = createMockSocket({ token: 'tok' });
      const result = await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      expect(result).toBe(false);
      expect(socket.emit).toHaveBeenCalledWith('join-error', { message: 'Access denied to this channel' });
    });

    it('should create the room if it does not yet exist', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      expect(rm.rooms.has('room1')).toBe(true);
    });

    it('should NOT create room if it already exists', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      rm.createRoom('room1', 'existing-owner');
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      expect(rm.rooms.get('room1')!.createdBy).toBe('existing-owner');
    });

    it('should add the user to room.users and this.users on success', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      const result = await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      expect(result).toBe(true);
      expect(rm.rooms.get('room1')!.users.has(socket.id)).toBe(true);
      expect(rm.users.has(socket.id)).toBe(true);
    });

    it('should call socket.join(roomId) and set socket.roomId', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      expect(socket.join).toHaveBeenCalledWith('room1');
      expect(socket.roomId).toBe('room1');
    });

    it('should call broadcastRoomList after successful join', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      expect(mockIo.emit).toHaveBeenCalledWith('room-list', expect.objectContaining({ rooms: expect.any(Array) }));
    });
  });

  describe('leaveRoom', () => {
    it('should do nothing if the room does not exist', () => {
      const rm = makeManager();
      const socket = createMockSocket({ roomId: 'nonexistent' });
      expect(() => rm.leaveRoom(socket as any, 'nonexistent')).not.toThrow();
    });

    it('should remove the user from room.users and this.users', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      rm.leaveRoom(socket as any, 'room1');
      expect(rm.rooms.has('room1')).toBe(false); // empty room deleted
      expect(rm.users.has(socket.id)).toBe(false);
    });

    it('should emit user-disconnected to the room with socket.peerId', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ token: 'tok', peerId: 'peer-abc' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      rm.leaveRoom(socket as any, 'room1');
      expect(toReturn.emit).toHaveBeenCalledWith('user-disconnected', 'peer-abc');
    });

    it('should delete the room when the last user leaves', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      rm.leaveRoom(socket as any, 'room1');
      expect(rm.rooms.has('room1')).toBe(false);
    });

    it('should NOT delete the room when other users remain', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const s1 = createMockSocket({ id: 'socket-001', token: 'tok', peerId: 'peer-001', userId: 'user-001' });
      const s2 = createMockSocket({ id: 'socket-002', token: 'tok', peerId: 'peer-002', userId: 'user-002' });
      await rm.joinRoom(s1 as any, 'room1', { socketId: s1.id, peerId: s1.peerId, alias: 'A', username: 'a', userId: 'user-001' });
      await rm.joinRoom(s2 as any, 'room1', { socketId: s2.id, peerId: s2.peerId, alias: 'B', username: 'b', userId: 'user-002' });
      rm.leaveRoom(s1 as any, 'room1');
      expect(rm.rooms.has('room1')).toBe(true);
      expect(rm.rooms.get('room1')!.users.size).toBe(1);
    });
  });

  describe('getExistingUsers', () => {
    it('should return empty array when room does not exist', () => {
      const rm = makeManager();
      expect(rm.getExistingUsers('nonexistent', 'socket-001')).toEqual([]);
    });

    it('should exclude the socket with the given excludeSocketId', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const s1 = createMockSocket({ id: 'socket-001', peerId: 'peer-001', userId: 'user-001', token: 'tok' });
      const s2 = createMockSocket({ id: 'socket-002', peerId: 'peer-002', userId: 'user-002', token: 'tok' });
      await rm.joinRoom(s1 as any, 'room1', { socketId: s1.id, peerId: s1.peerId, alias: 'A', username: 'a', userId: 'user-001' });
      await rm.joinRoom(s2 as any, 'room1', { socketId: s2.id, peerId: s2.peerId, alias: 'B', username: 'b', userId: 'user-002' });
      const existing = rm.getExistingUsers('room1', 'socket-001');
      expect(existing).toHaveLength(1);
      expect(existing[0].userId).toBe('user-002');
    });

    it('should return peerId, alias, userId for all other users', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const s1 = createMockSocket({ id: 'socket-001', peerId: 'peer-001', userId: 'user-001', token: 'tok' });
      const s2 = createMockSocket({ id: 'socket-002', peerId: 'peer-002', userId: 'user-002', token: 'tok' });
      await rm.joinRoom(s1 as any, 'room1', { socketId: s1.id, peerId: s1.peerId, alias: 'A', username: 'a', userId: 'user-001' });
      await rm.joinRoom(s2 as any, 'room1', { socketId: s2.id, peerId: s2.peerId, alias: 'B', username: 'b', userId: 'user-002' });
      const existing = rm.getExistingUsers('room1', 'socket-001');
      expect(existing[0]).toMatchObject({ peerId: 'peer-002', alias: 'B', userId: 'user-002' });
    });
  });

  describe('updateUserAlias', () => {
    it('should return null if socketId is not in this.users', () => {
      const rm = makeManager();
      expect(rm.updateUserAlias('unknown-socket', 'NewAlias')).toBeNull();
    });

    it('should update alias in both this.users and room.users and return updated user', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      const socket = createMockSocket({ token: 'tok' });
      await rm.joinRoom(socket as any, 'room1', {
        socketId: socket.id, peerId: socket.peerId, alias: 'Alice', username: 'alice', userId: 'user-001',
      });
      const updated = rm.updateUserAlias(socket.id, 'Bob');
      expect(updated!.alias).toBe('Bob');
      expect(rm.users.get(socket.id)!.alias).toBe('Bob');
      expect(rm.rooms.get('room1')!.users.get(socket.id)!.alias).toBe('Bob');
    });
  });

  describe('checkChannelAccess', () => {
    it('should return true when fetch responds with ok=true', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      expect(await rm.checkChannelAccess('room1', 'token')).toBe(true);
    });

    it('should return false when fetch responds with ok=false', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: false, status: 403 });
      expect(await rm.checkChannelAccess('room1', 'token')).toBe(false);
    });

    it('should return false when fetch throws a network error', async () => {
      const rm = makeManager();
      mockFetch.mockRejectedValue(new Error('Network error'));
      expect(await rm.checkChannelAccess('room1', 'token')).toBe(false);
    });

    it('should call fetch with the correct URL and Authorization header', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      await rm.checkChannelAccess('channel-123', 'mytoken');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://hub-test:3000/channels/channel-123/access',
        { headers: { Authorization: 'Bearer mytoken' } }
      );
    });
  });

  describe('checkHubMembership', () => {
    it('should return true when fetch responds with ok=true', async () => {
      const rm = makeManager();
      mockFetch.mockResolvedValue({ ok: true });
      expect(await rm.checkHubMembership('hub1', 'token')).toBe(true);
    });

    it('should return false when fetch throws', async () => {
      const rm = makeManager();
      mockFetch.mockRejectedValue(new Error('fail'));
      expect(await rm.checkHubMembership('hub1', 'token')).toBe(false);
    });
  });

  describe('broadcastRoomList', () => {
    it('should emit room-list with array of { id, userCount, createdBy }', () => {
      const rm = makeManager();
      rm.createRoom('room1', 'user-001');
      rm.createRoom('room2', 'user-002');
      rm.broadcastRoomList();
      const call = (mockIo.emit as jest.Mock).mock.calls.find(([event]: [string]) => event === 'room-list');
      expect(call).toBeDefined();
      const { rooms } = call![1];
      expect(rooms).toHaveLength(2);
      expect(rooms[0]).toMatchObject({ id: expect.any(String), userCount: 0, createdBy: expect.any(String) });
    });
  });
});
