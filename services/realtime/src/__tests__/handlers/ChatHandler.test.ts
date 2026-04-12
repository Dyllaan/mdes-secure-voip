import ChatHandler from '../../handlers/ChatHandler';
import { createMockSocket } from '../helpers/createMockSocket';
import { ChatMessage } from '../../types';
import config from '../../config';

const cfg = config.services.realtime;

function makeHandler(overrides: {
  messageQueues?: Map<string, ChatMessage[]>;
  users?: Map<string, any>;
  findSocketByUserId?: (id: string) => any;
} = {}) {
  const users = overrides.users ?? new Map<string, any>();
  const messageQueues = overrides.messageQueues ?? new Map<string, ChatMessage[]>();
  const parent = {
    config: cfg,
    messageQueues,
    roomManager: { users },
    findSocketByUserId: overrides.findSocketByUserId ?? (() => null),
  };
  return { handler: new ChatHandler(parent as any), messageQueues };
}

describe('ChatHandler', () => {
  describe('handleEncryptedMessage', () => {
    it('should emit chat-error "Not authenticated" when socket.id is not in roomManager.users', () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'abc', type: 1, registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Not authenticated' });
    });

    it('should emit chat-error "Invalid recipient" when recipientUserId is missing', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: '', ciphertext: 'abc', type: 1, registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Invalid recipient' });
    });

    it('should emit chat-error "Invalid ciphertext" when ciphertext is missing', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: '', type: 1, registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Invalid ciphertext' });
    });

    it('should emit chat-error "Encrypted message too large" when ciphertext exceeds limit', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002',
        ciphertext: 'a'.repeat(cfg.security.maxMessageLength * 4 + 1),
        type: 1,
        registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Encrypted message too large' });
    });

    it('should emit chat-error "Invalid message type" for type not in [1, 3]', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'abc', type: 2 as any, registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Invalid message type (must be 1 or 3)' });
    });

    it('should emit chat-error "Invalid registration ID" when registrationId is negative', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'abc', type: 1, registrationId: -1,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Invalid registration ID' });
    });

    it('should emit chat-error "Invalid registration ID" when registrationId is not a number', () => {
      const socket = createMockSocket({ id: 'socket-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'abc', type: 1, registrationId: 'abc' as any,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Invalid registration ID' });
    });

    it('should queue the message and emit message-queued when recipient socket is not found', () => {
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler, messageQueues } = makeHandler({ users, findSocketByUserId: () => null });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'hello', type: 1, registrationId: 100,
      });
      expect(messageQueues.get('user-002')).toHaveLength(1);
      expect(socket.emit).toHaveBeenCalledWith('message-queued', expect.objectContaining({ message: 'Recipient offline, message queued' }));
    });

    it('should emit chat-error "queue is full" when queue already has maxQueuedMessages and NOT grow it', () => {
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const fullQueue = Array.from({ length: cfg.security.maxQueuedMessages }, (_, i) => ({
        id: `msg-${i}`, senderUserId: 'user-001', senderPeerId: 'peer-001', senderAlias: 'Alice',
        ciphertext: 'x', type: 1 as const, registrationId: 0, timestamp: '', queuedAt: 0,
      }));
      const messageQueues = new Map<string, ChatMessage[]>([['user-002', fullQueue]]);
      const { handler } = makeHandler({ users, messageQueues, findSocketByUserId: () => null });

      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'overflow', type: 1, registrationId: 100,
      });
      expect(messageQueues.get('user-002')!.length).toBe(cfg.security.maxQueuedMessages); // not grown
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Recipient message queue is full' });
    });

    it('should emit chat-error "Users not in same room" when rooms differ', () => {
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001', roomId: 'room-A' });
      const recipientSocket = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room-B' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room-A' }]]);
      const { handler } = makeHandler({ users, findSocketByUserId: () => recipientSocket });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'hello', type: 1, registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Users not in same room' });
      expect(recipientSocket.emit).not.toHaveBeenCalled();
    });

    it('should emit chat-error "Users not in same room" when sender has no roomId', () => {
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001', roomId: undefined });
      const recipientSocket = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room1' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users, findSocketByUserId: () => recipientSocket });
      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'hello', type: 1, registrationId: 100,
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Users not in same room' });
    });

    it('should deliver encrypted-chat-message to recipient and emit message-delivered to sender', () => {
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001', roomId: 'room1' });
      const recipientSocket = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room1' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users, findSocketByUserId: () => recipientSocket });

      handler.handleEncryptedMessage(socket as any, {
        recipientUserId: 'user-002', ciphertext: 'hello', type: 1, registrationId: 100,
      });
      expect(recipientSocket.emit).toHaveBeenCalledWith('encrypted-chat-message', expect.objectContaining({
        senderUserId: 'user-001',
        ciphertext: 'hello',
        type: 1,
      }));
      expect(socket.emit).toHaveBeenCalledWith('message-delivered', expect.objectContaining({
        messageId: expect.any(String),
        recipientUserId: 'user-002',
      }));
    });

    it('should generate a unique hex messageId for each delivered message', () => {
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001', roomId: 'room1' });
      const recipientSocket1 = createMockSocket({ id: 'socket-002', userId: 'user-002', roomId: 'room1' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users, findSocketByUserId: () => recipientSocket1 });

      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        (socket.emit as jest.Mock).mockClear();
        handler.handleEncryptedMessage(socket as any, { recipientUserId: 'user-002', ciphertext: 'hello', type: 1, registrationId: 100 });
        const call = (socket.emit as jest.Mock).mock.calls.find(([e]: [string]) => e === 'message-delivered');
        ids.add(call?.[1]?.messageId);
      }
      expect(ids.size).toBe(10);
    });
  });

  describe('handleRoomMessage', () => {
    it('should emit chat-error "Not authenticated" when socket.id is not in roomManager.users', () => {
      const socket = createMockSocket();
      const { handler } = makeHandler();
      handler.handleRoomMessage(socket as any, { roomId: 'room1', ciphertext: 'c', iv: 'i', keyId: 'k' });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Not authenticated' });
    });

    it('should emit chat-error "Not in specified room" when socket.roomId does not match roomId', () => {
      const socket = createMockSocket({ id: 'socket-001', roomId: 'room-A' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room-A' }]]);
      const { handler } = makeHandler({ users });
      handler.handleRoomMessage(socket as any, { roomId: 'room-B', ciphertext: 'c', iv: 'i', keyId: 'k' });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Not in specified room' });
    });

    it('should emit chat-error "Not in specified room" when socket has no roomId', () => {
      const socket = createMockSocket({ id: 'socket-001', roomId: undefined });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice' }]]);
      const { handler } = makeHandler({ users });
      handler.handleRoomMessage(socket as any, { roomId: 'room1', ciphertext: 'c', iv: 'i', keyId: 'k' });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Not in specified room' });
    });

    it('should emit chat-error "Invalid encrypted message data" when fields are missing', () => {
      const socket = createMockSocket({ id: 'socket-001', roomId: 'room1' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleRoomMessage(socket as any, { roomId: 'room1', ciphertext: '', iv: 'i', keyId: 'k' });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Invalid encrypted message data' });
    });

    it('should emit chat-error "Message too large" when ciphertext exceeds limit', () => {
      const socket = createMockSocket({ id: 'socket-001', roomId: 'room1' });
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });
      handler.handleRoomMessage(socket as any, {
        roomId: 'room1',
        ciphertext: 'a'.repeat(cfg.security.maxMessageLength * 4 + 1),
        iv: 'iv',
        keyId: 'k1',
      });
      expect(socket.emit).toHaveBeenCalledWith('chat-error', { message: 'Message too large' });
    });

    it('should broadcast room-chat-message to room with correct sender metadata', () => {
      const toReturn = { emit: jest.fn() };
      const socket = createMockSocket({ id: 'socket-001', userId: 'user-001', roomId: 'room1', peerId: 'peer-001' });
      (socket.to as jest.Mock).mockReturnValue(toReturn);
      const users = new Map([['socket-001', { peerId: 'peer-001', alias: 'Alice', roomId: 'room1' }]]);
      const { handler } = makeHandler({ users });

      handler.handleRoomMessage(socket as any, { roomId: 'room1', ciphertext: 'enc', iv: 'myiv', keyId: 'k1' });
      expect(socket.to).toHaveBeenCalledWith('room1');
      expect(toReturn.emit).toHaveBeenCalledWith('room-chat-message', expect.objectContaining({
        senderUserId: 'user-001',
        senderPeerId: 'peer-001',
        senderAlias: 'Alice',
        ciphertext: 'enc',
        iv: 'myiv',
        keyId: 'k1',
      }));
    });
  });
});
