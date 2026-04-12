import RoomKeyHandler from '../../handlers/RoomKeyHandler';
import { createMockSocket } from '../helpers/createMockSocket';

function makeHandler(overrides: {
  rsaPublicKeys?: Map<string, string>;
  findSocketByUserId?: (id: string) => any;
  roomManager?: any;
} = {}) {
  const parent = {
    rsaPublicKeys: overrides.rsaPublicKeys ?? new Map<string, string>(),
    roomManager: overrides.roomManager ?? { rooms: new Map(), users: new Map() },
    findSocketByUserId: overrides.findSocketByUserId ?? (() => null),
  };
  return new RoomKeyHandler(parent as any);
}

describe('RoomKeyHandler', () => {
  describe('handleRegisterRSAKey', () => {
    it('should emit signal-error "Invalid RSA public key" when publicKey is missing', () => {
      const socket = createMockSocket();
      const handler = makeHandler();
      handler.handleRegisterRSAKey(socket as any, { publicKey: '' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid RSA public key' });
    });

    it('should emit signal-error "Invalid RSA public key" when publicKey is not a string', () => {
      const socket = createMockSocket();
      const handler = makeHandler();
      handler.handleRegisterRSAKey(socket as any, { publicKey: 123 as any });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid RSA public key' });
    });

    it('should emit signal-error "RSA public key too large" when publicKey exceeds 1000 chars', () => {
      const socket = createMockSocket();
      const handler = makeHandler();
      handler.handleRegisterRSAKey(socket as any, { publicKey: 'a'.repeat(1001) });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'RSA public key too large' });
    });

    it('should store the sanitized public key in rsaPublicKeys', () => {
      const rsaPublicKeys = new Map<string, string>();
      const socket = createMockSocket({ userId: 'user-001' });
      const handler = makeHandler({ rsaPublicKeys });
      handler.handleRegisterRSAKey(socket as any, { publicKey: 'VALIDKEY123' });
      expect(rsaPublicKeys.has('user-001')).toBe(true);
      expect(rsaPublicKeys.get('user-001')).toBe('VALIDKEY123');
    });

    it('should emit rsa-key-registered with success=true on success', () => {
      const socket = createMockSocket();
      const handler = makeHandler();
      handler.handleRegisterRSAKey(socket as any, { publicKey: 'VALIDKEY123' });
      expect(socket.emit).toHaveBeenCalledWith('rsa-key-registered', { success: true });
    });

    it('should broadcast user-rsa-key to the room when socket.roomId is set', () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ userId: 'user-001', roomId: 'room1' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const handler = makeHandler();
      handler.handleRegisterRSAKey(socket as any, { publicKey: 'VALIDKEY123' });
      expect(socket.to).toHaveBeenCalledWith('room1');
      expect(toReturn.emit).toHaveBeenCalledWith('user-rsa-key', { userId: 'user-001', publicKey: 'VALIDKEY123' });
    });

    it('should NOT broadcast to room when socket.roomId is undefined', () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ roomId: undefined });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const handler = makeHandler();
      handler.handleRegisterRSAKey(socket as any, { publicKey: 'VALIDKEY123' });
      expect(toReturn.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleRequestRSAKey', () => {
    it('should emit signal-error "Invalid user ID" when userId is missing', () => {
      const socket = createMockSocket();
      const handler = makeHandler();
      handler.handleRequestRSAKey(socket as any, { userId: '' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid user ID' });
    });

    it('should emit signal-error "User not found in your current room" when target socket not found', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandler({ findSocketByUserId: () => null });
      handler.handleRequestRSAKey(socket as any, { userId: 'user-002' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'User not found in your current room' });
    });

    it('should emit signal-error "User not found in your current room" when target socket is in different room', () => {
      const socket = createMockSocket({ roomId: 'room-A' });
      const targetSocket = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room-B' });
      const handler = makeHandler({ findSocketByUserId: () => targetSocket });
      handler.handleRequestRSAKey(socket as any, { userId: 'user-002' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'User not found in your current room' });
    });

    it('should emit signal-error "RSA public key not found for user" when key is absent', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const targetSocket = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room1' });
      const handler = makeHandler({ findSocketByUserId: () => targetSocket });
      handler.handleRequestRSAKey(socket as any, { userId: 'user-002' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'RSA public key not found for user' });
    });

    it('should emit user-rsa-key with the public key on success', () => {
      const rsaPublicKeys = new Map([['user-002', 'PUBKEY456']]);
      const socket = createMockSocket({ roomId: 'room1' });
      const targetSocket = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room1' });
      const handler = makeHandler({ rsaPublicKeys, findSocketByUserId: () => targetSocket });
      handler.handleRequestRSAKey(socket as any, { userId: 'user-002' });
      expect(socket.emit).toHaveBeenCalledWith('user-rsa-key', { userId: 'user-002', publicKey: 'PUBKEY456' });
    });
  });

  describe('handleRoomKeyRequest', () => {
    it('should emit signal-error "Not in specified room" when socket.roomId does not match roomId', () => {
      const socket = createMockSocket({ roomId: 'room-A' });
      const handler = makeHandler();
      handler.handleRoomKeyRequest(socket as any, { roomId: 'room-B', fromUserId: 'user-provider' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Not in specified room' });
    });

    it('should emit signal-error "Key provider not found" when findSocketByUserId returns null', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandler({ findSocketByUserId: () => null });
      handler.handleRoomKeyRequest(socket as any, { roomId: 'room1', fromUserId: 'user-provider' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Key provider not found' });
    });

    it('should emit request-room-key on the provider socket with correct data', () => {
      const socket = createMockSocket({ userId: 'user-requester', roomId: 'room1' });
      const providerSocket = createMockSocket({ id: 'socket-provider', userId: 'user-provider', roomId: 'room1' });
      const handler = makeHandler({ findSocketByUserId: () => providerSocket });
      handler.handleRoomKeyRequest(socket as any, { roomId: 'room1', fromUserId: 'user-provider' });
      expect(providerSocket.emit).toHaveBeenCalledWith('request-room-key', { roomId: 'room1', requesterId: 'user-requester' });
    });
  });

  describe('handleRoomKeyResponse', () => {
    it('should emit signal-error "Not in specified room" when socket.roomId does not match', () => {
      const socket = createMockSocket({ roomId: 'room-A' });
      const handler = makeHandler();
      handler.handleRoomKeyResponse(socket as any, { roomId: 'room-B', requesterId: 'req', encryptedKey: 'key', keyId: 'k1' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Not in specified room' });
    });

    it('should emit signal-error "Not authorized" when no pending provider exists for requesterId', () => {
      const socket = createMockSocket({ userId: 'user-provider', roomId: 'room1' });
      const handler = makeHandler();
      handler.handleRoomKeyResponse(socket as any, { roomId: 'room1', requesterId: 'nobody', encryptedKey: 'key', keyId: 'k1' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Not authorized to respond to this key request' });
    });

    it('SECURITY: should reject impostor - socket.userId ≠ expected provider', () => {
      const requesterSocket = createMockSocket({ id: 'socket-requester', userId: 'user-requester', roomId: 'room1' });
      const providerSocket = createMockSocket({ id: 'socket-provider', userId: 'user-provider', roomId: 'room1' });
      const impostorSocket = createMockSocket({ id: 'socket-impostor', userId: 'user-attacker', roomId: 'room1' });

      const handler = makeHandler({ findSocketByUserId: (id: string) => {
        if (id === 'user-requester') return requesterSocket;
        if (id === 'user-provider') return providerSocket;
        return null;
      }});

      handler.handleRoomKeyRequest(requesterSocket as any, { roomId: 'room1', fromUserId: 'user-provider' });

      handler.handleRoomKeyResponse(impostorSocket as any, { roomId: 'room1', requesterId: 'user-requester', encryptedKey: 'evil-key', keyId: 'k-evil' });

      expect(impostorSocket.emit).toHaveBeenCalledWith('signal-error', { message: 'Not authorized to respond to this key request' });
      expect(requesterSocket.emit).not.toHaveBeenCalledWith('room-key-response', expect.anything());
    });

    it('should emit room-key-response on the requester socket and clear pending entry', () => {
      const requesterSocket = createMockSocket({ id: 'socket-requester', userId: 'user-requester', roomId: 'room1' });
      const providerSocket = createMockSocket({ id: 'socket-provider', userId: 'user-provider', roomId: 'room1' });

      const handler = makeHandler({ findSocketByUserId: (id: string) => {
        if (id === 'user-requester') return requesterSocket;
        if (id === 'user-provider') return providerSocket;
        return null;
      }});

      handler.handleRoomKeyRequest(requesterSocket as any, { roomId: 'room1', fromUserId: 'user-provider' });
      handler.handleRoomKeyResponse(providerSocket as any, { roomId: 'room1', requesterId: 'user-requester', encryptedKey: 'enc-key', keyId: 'key-001' });

      expect(requesterSocket.emit).toHaveBeenCalledWith('room-key-response', { encryptedKey: 'enc-key', keyId: 'key-001' });
    });

    it('should emit signal-error "Requester not found" and delete pending entry when requester socket is gone', () => {
      const providerSocket = createMockSocket({ id: 'socket-provider', userId: 'user-provider', roomId: 'room1' });
      const requesterSocket = createMockSocket({ id: 'socket-requester', userId: 'user-requester', roomId: 'room1' });

      let requesterGone = false;
      const handler = makeHandler({ findSocketByUserId: (id: string) => {
        if (id === 'user-provider') return providerSocket;
        if (id === 'user-requester') return requesterGone ? null : requesterSocket;
        return null;
      }});

      handler.handleRoomKeyRequest(requesterSocket as any, { roomId: 'room1', fromUserId: 'user-provider' });
      requesterGone = true;

      handler.handleRoomKeyResponse(providerSocket as any, { roomId: 'room1', requesterId: 'user-requester', encryptedKey: 'key', keyId: 'k1' });
      expect(providerSocket.emit).toHaveBeenCalledWith('signal-error', { message: 'Requester not found' });
    });
  });
});
