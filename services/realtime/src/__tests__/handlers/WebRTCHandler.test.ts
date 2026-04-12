import WebRTCHandler from '../../handlers/WebRTCHandler';
import { createMockSocket } from '../helpers/createMockSocket';

function makeHandler(findSocketByPeerId: (id: string) => any) {
  return new WebRTCHandler({ findSocketByPeerId: () => findSocketByPeerId('') });
  // Override properly:
}

function makeHandlerWith(findByPeerId: (id: string) => any) {
  const parent = { findSocketByPeerId: findByPeerId };
  return new (WebRTCHandler as any)(parent) as WebRTCHandler;
}

describe('WebRTCHandler', () => {
  const offer = { type: 'offer', sdp: 'v=0\r\n' };
  const answer = { type: 'answer', sdp: 'v=0\r\n' };
  const candidate = { candidate: 'candidate:1 1 UDP 12345 192.0.2.1 5000 typ host' };

  describe('handleOffer', () => {
    it('should emit webrtc-error "Invalid offer data" when targetPeerId is missing', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(jest.fn());
      handler.handleOffer(socket as any, { targetPeerId: '', offer });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Invalid offer data' });
    });

    it('should emit webrtc-error "Invalid offer data" when offer is missing', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(jest.fn());
      handler.handleOffer(socket as any, { targetPeerId: 'peer-002', offer: null as any });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Invalid offer data' });
    });

    it('should emit webrtc-error "Target peer not found" when findSocketByPeerId returns null', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(() => null);
      handler.handleOffer(socket as any, { targetPeerId: 'peer-002', offer });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Target peer not found' });
    });

    it('should emit webrtc-error "Users not in same room" when sockets are in different rooms', () => {
      const socket = createMockSocket({ roomId: 'room-A', peerId: 'peer-001' });
      const targetSocket = createMockSocket({ id: 'socket-002', roomId: 'room-B', peerId: 'peer-002' });
      const handler = makeHandlerWith(() => targetSocket);
      handler.handleOffer(socket as any, { targetPeerId: 'peer-002', offer });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Users not in same room' });
    });

    it('should relay webrtc-offer to the target socket with fromPeerId and offer', () => {
      const socket = createMockSocket({ roomId: 'room1', peerId: 'peer-001' });
      const targetSocket = createMockSocket({ id: 'socket-002', roomId: 'room1', peerId: 'peer-002' });
      const handler = makeHandlerWith(() => targetSocket);
      handler.handleOffer(socket as any, { targetPeerId: 'peer-002', offer });
      expect(targetSocket.emit).toHaveBeenCalledWith('webrtc-offer', { fromPeerId: 'peer-001', offer });
    });
  });

  describe('handleAnswer', () => {
    it('should emit webrtc-error "Invalid answer data" when targetPeerId or answer is missing', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(jest.fn());
      handler.handleAnswer(socket as any, { targetPeerId: '', answer });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Invalid answer data' });
    });

    it('should emit webrtc-error "Target peer not found" when findSocketByPeerId returns null', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(() => null);
      handler.handleAnswer(socket as any, { targetPeerId: 'peer-002', answer });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Target peer not found' });
    });

    it('should emit webrtc-error "Users not in same room" when rooms differ', () => {
      const socket = createMockSocket({ roomId: 'room-A', peerId: 'peer-001' });
      const targetSocket = createMockSocket({ id: 'socket-002', roomId: 'room-B', peerId: 'peer-002' });
      const handler = makeHandlerWith(() => targetSocket);
      handler.handleAnswer(socket as any, { targetPeerId: 'peer-002', answer });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Users not in same room' });
    });

    it('should relay webrtc-answer to the target socket with fromPeerId and answer', () => {
      const socket = createMockSocket({ roomId: 'room1', peerId: 'peer-001' });
      const targetSocket = createMockSocket({ id: 'socket-002', roomId: 'room1', peerId: 'peer-002' });
      const handler = makeHandlerWith(() => targetSocket);
      handler.handleAnswer(socket as any, { targetPeerId: 'peer-002', answer });
      expect(targetSocket.emit).toHaveBeenCalledWith('webrtc-answer', { fromPeerId: 'peer-001', answer });
    });
  });

  describe('handleIceCandidate', () => {
    it('should emit webrtc-error "Invalid ICE candidate data" when targetPeerId or candidate is missing', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(jest.fn());
      handler.handleIceCandidate(socket as any, { targetPeerId: '', candidate });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Invalid ICE candidate data' });
    });

    it('should emit webrtc-error "Target peer not found" when findSocketByPeerId returns null', () => {
      const socket = createMockSocket({ roomId: 'room1' });
      const handler = makeHandlerWith(() => null);
      handler.handleIceCandidate(socket as any, { targetPeerId: 'peer-002', candidate });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Target peer not found' });
    });

    it('should emit webrtc-error "Users not in same room" when rooms differ (cross-room relay prevention)', () => {
      const socket = createMockSocket({ roomId: 'room-A', peerId: 'peer-001' });
      const targetSocket = createMockSocket({ id: 'socket-002', roomId: 'room-B', peerId: 'peer-002' });
      const handler = makeHandlerWith(() => targetSocket);
      handler.handleIceCandidate(socket as any, { targetPeerId: 'peer-002', candidate });
      expect(socket.emit).toHaveBeenCalledWith('webrtc-error', { message: 'Users not in same room' });
      expect(targetSocket.emit).not.toHaveBeenCalled();
    });

    it('should relay webrtc-ice-candidate to the target socket with fromPeerId and candidate', () => {
      const socket = createMockSocket({ roomId: 'room1', peerId: 'peer-001' });
      const targetSocket = createMockSocket({ id: 'socket-002', roomId: 'room1', peerId: 'peer-002' });
      const handler = makeHandlerWith(() => targetSocket);
      handler.handleIceCandidate(socket as any, { targetPeerId: 'peer-002', candidate });
      expect(targetSocket.emit).toHaveBeenCalledWith('webrtc-ice-candidate', { fromPeerId: 'peer-001', candidate });
    });
  });
});
