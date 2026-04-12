import SignalProtocolHandler from '../../handlers/SignalProtocolHandler';
import { createMockSocket } from '../helpers/createMockSocket';
import { SignalKeyBundle } from '../../types';

function makeHandler(signalKeys: Map<string, SignalKeyBundle>, findSocketByUserId: (id: string) => any = () => null) {
  return new SignalProtocolHandler({ signalKeys, findSocketByUserId } as any);
}

const validBundle = () => ({
  identityKey: 'a'.repeat(44),
  signedPreKey: { keyId: 1, publicKey: 'b'.repeat(44), signature: 'c'.repeat(88) },
  preKeys: Array.from({ length: 20 }, (_, i) => ({ keyId: i + 1, publicKey: 'd'.repeat(44) })),
  registrationId: 12345,
});

describe('SignalProtocolHandler', () => {
  describe('handleRegisterKeys', () => {
    it('should emit signal-error "Missing required key data" when identityKey is absent', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      const data = validBundle();
      handler.handleRegisterKeys(socket as any, { ...data, identityKey: '' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', expect.objectContaining({ message: 'Missing required key data' }));
    });

    it('should emit signal-error "Missing required key data" when signedPreKey is absent', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), signedPreKey: null as any });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', expect.objectContaining({ message: 'Missing required key data' }));
    });

    it('should emit signal-error when identityKey is shorter than 20 chars', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), identityKey: 'short' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid identity key format' });
    });

    it('should emit signal-error when identityKey exceeds 500 chars', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), identityKey: 'a'.repeat(501) });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid identity key format' });
    });

    it('should emit signal-error when signedPreKey.signature is missing', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      const data = { ...validBundle(), signedPreKey: { keyId: 1, publicKey: 'b'.repeat(44), signature: '' } };
      handler.handleRegisterKeys(socket as any, data);
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid signed pre-key structure' });
    });

    it('should emit signal-error "preKeys must be an array" when preKeys is not an array', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), preKeys: 'not-array' as any });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'preKeys must be an array' });
    });

    it('should emit signal-error when preKeys array is empty', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), preKeys: [] });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'preKeys array must contain 1-100 keys' });
    });

    it('should emit signal-error when preKeys array has more than 100 entries', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      const tooMany = Array.from({ length: 101 }, (_, i) => ({ keyId: i + 1, publicKey: 'd'.repeat(44) }));
      handler.handleRegisterKeys(socket as any, { ...validBundle(), preKeys: tooMany });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'preKeys array must contain 1-100 keys' });
    });

    it('should emit signal-error when registrationId is negative', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), registrationId: -1 });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid registration ID (must be 0-16383)' });
    });

    it('should emit signal-error when registrationId exceeds 16383', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRegisterKeys(socket as any, { ...validBundle(), registrationId: 16384 });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', { message: 'Invalid registration ID (must be 0-16383)' });
    });

    it('should store the key bundle in signalKeys keyed by socket.userId on success', () => {
      const socket = createMockSocket({ userId: 'user-001' });
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      handler.handleRegisterKeys(socket as any, validBundle());
      expect(signalKeys.has('user-001')).toBe(true);
    });

    it('should emit signal-keys-registered with success=true and prekeyCount', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      const data = validBundle();
      handler.handleRegisterKeys(socket as any, data);
      expect(socket.emit).toHaveBeenCalledWith('signal-keys-registered', {
        success: true,
        prekeyCount: data.preKeys.length,
      });
    });
  });

  describe('handleRequestBundle', () => {
    it('should emit signal-error "Invalid recipient user ID" when recipientUserId is missing', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRequestBundle(socket as any, { recipientUserId: '' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', expect.objectContaining({ message: 'Invalid recipient user ID' }));
    });

    it('should emit signal-error when no bundle exists for the recipient', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', expect.objectContaining({ message: 'Recipient has not registered Signal keys' }));
    });

    it('should pop the first one-time prekey from the bundle (consuming it permanently)', () => {
      const socket = createMockSocket();
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      // Register keys for user-002
      const regSocket = createMockSocket({ userId: 'user-002' });
      handler.handleRegisterKeys(regSocket as any, validBundle());

      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      expect(signalKeys.get('user-002')!.preKeys.size).toBe(19); // 20 - 1 consumed
    });

    it('should consume different prekeys on consecutive calls', () => {
      const socket = createMockSocket();
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      const regSocket = createMockSocket({ userId: 'user-002' });
      handler.handleRegisterKeys(regSocket as any, validBundle());

      const call1: any = {};
      (socket.emit as jest.Mock).mockImplementation((event, data) => { if (event === 'signal-prekey-bundle') call1.preKey = data.preKey; });
      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      const firstKeyId = call1.preKey?.keyId;

      const call2: any = {};
      const socket2 = createMockSocket();
      (socket2.emit as jest.Mock).mockImplementation((event, data) => { if (event === 'signal-prekey-bundle') call2.preKey = data.preKey; });
      handler.handleRequestBundle(socket2 as any, { recipientUserId: 'user-002' });
      const secondKeyId = call2.preKey?.keyId;

      expect(firstKeyId).not.toBe(secondKeyId);
    });

    it('should emit signal-prekeys-low on recipient socket when fewer than 10 prekeys remain', () => {
      // Register 10 prekeys -> after consuming one -> 9 remain -> should emit low
      const socket = createMockSocket();
      const signalKeys = new Map<string, SignalKeyBundle>();
      const recipientSocket = createMockSocket({ userId: 'user-002' });
      const handler = makeHandler(signalKeys, (id) => id === 'user-002' ? recipientSocket : null);
      const data = { ...validBundle(), preKeys: Array.from({ length: 10 }, (_, i) => ({ keyId: i + 1, publicKey: 'd'.repeat(44) })) };
      handler.handleRegisterKeys(recipientSocket as any, data);

      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      expect(recipientSocket.emit).toHaveBeenCalledWith('signal-prekeys-low', { remaining: 9 });
    });

    it('should NOT emit signal-prekeys-low when 10 or more prekeys remain', () => {
      const socket = createMockSocket();
      const signalKeys = new Map<string, SignalKeyBundle>();
      const recipientSocket = createMockSocket({ userId: 'user-002' });
      const handler = makeHandler(signalKeys, (id) => id === 'user-002' ? recipientSocket : null);
      // 20 prekeys -> after consuming one -> 19 remain -> no low warning
      handler.handleRegisterKeys(recipientSocket as any, validBundle());

      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      expect(recipientSocket.emit).not.toHaveBeenCalledWith('signal-prekeys-low', expect.anything());
    });

    it('should include null for preKey when bundle has no one-time prekeys', () => {
      const socket = createMockSocket();
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      const regSocket = createMockSocket({ userId: 'user-002' });
      const data = { ...validBundle(), preKeys: [{ keyId: 1, publicKey: 'd'.repeat(44) }] };
      handler.handleRegisterKeys(regSocket as any, data);
      // Consume the only prekey
      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      (socket.emit as jest.Mock).mockClear();
      // Second request -> no prekeys left
      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      const bundleCall = (socket.emit as jest.Mock).mock.calls.find(([e]: [string]) => e === 'signal-prekey-bundle');
      expect(bundleCall![1].preKey).toBeNull();
    });

    it('should emit signal-prekey-bundle with correct structure', () => {
      const socket = createMockSocket();
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      const regSocket = createMockSocket({ userId: 'user-002' });
      handler.handleRegisterKeys(regSocket as any, validBundle());

      handler.handleRequestBundle(socket as any, { recipientUserId: 'user-002' });
      const call = (socket.emit as jest.Mock).mock.calls.find(([e]: [string]) => e === 'signal-prekey-bundle');
      const bundle = call![1];
      expect(bundle).toMatchObject({
        userId: 'user-002',
        registrationId: expect.any(Number),
        identityKey: expect.any(String),
        signedPreKey: expect.objectContaining({ keyId: expect.any(Number) }),
        preKey: expect.objectContaining({ keyId: expect.any(Number) }),
      });
    });
  });

  describe('handleRefreshPrekeys', () => {
    it('should emit signal-error when preKeys is not an array', () => {
      const socket = createMockSocket();
      const handler = makeHandler(new Map());
      handler.handleRefreshPrekeys(socket as any, { preKeys: null as any });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', expect.objectContaining({ message: 'Invalid pre-keys array (must contain 1-100 keys)' }));
    });

    it('should emit signal-error "No key bundle found" when socket.userId has no bundle', () => {
      const socket = createMockSocket({ userId: 'user-without-bundle' });
      const handler = makeHandler(new Map());
      handler.handleRefreshPrekeys(socket as any, { preKeys: [{ keyId: 200, publicKey: 'e'.repeat(44) }] });
      expect(socket.emit).toHaveBeenCalledWith('signal-error', expect.objectContaining({ message: 'No key bundle found. Register keys first.' }));
    });

    it('should add new prekeys to the existing bundle', () => {
      const socket = createMockSocket({ userId: 'user-001' });
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      handler.handleRegisterKeys(socket as any, validBundle()); // 20 prekeys
      handler.handleRefreshPrekeys(socket as any, { preKeys: [{ keyId: 100, publicKey: 'e'.repeat(44) }, { keyId: 101, publicKey: 'f'.repeat(44) }] });
      expect(signalKeys.get('user-001')!.preKeys.has(100)).toBe(true);
      expect(signalKeys.get('user-001')!.preKeys.has(101)).toBe(true);
    });

    it('should emit signal-prekeys-refreshed with totalPrekeys count', () => {
      const socket = createMockSocket({ userId: 'user-001' });
      const signalKeys = new Map<string, SignalKeyBundle>();
      const handler = makeHandler(signalKeys);
      handler.handleRegisterKeys(socket as any, validBundle()); // 20 prekeys
      (socket.emit as jest.Mock).mockClear();
      handler.handleRefreshPrekeys(socket as any, { preKeys: [{ keyId: 100, publicKey: 'e'.repeat(44) }] });
      expect(socket.emit).toHaveBeenCalledWith('signal-prekeys-refreshed', { success: true, totalPrekeys: 21 });
    });
  });
});
