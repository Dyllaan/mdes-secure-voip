import { AuthenticatedSocket } from '../types';
interface RTCSessionDescriptionInit {
    type: string;
    sdp: string;
}

interface RTCIceCandidateInit {
    candidate: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
}
interface WebRTCOfferData {
    targetPeerId: string;
    offer: RTCSessionDescriptionInit;
}

interface WebRTCAnswerData {
    targetPeerId: string;
    answer: RTCSessionDescriptionInit;
}

interface WebRTCIceCandidateData {
    targetPeerId: string;
    candidate: RTCIceCandidateInit;
}

interface Parent {
    findSocketByPeerId: (peerId: string) => AuthenticatedSocket | null;
}

class WebRTCHandler {
    private findSocketByPeerId: (peerId: string) => AuthenticatedSocket | null;

    constructor(parent: Parent) {
        this.findSocketByPeerId = parent.findSocketByPeerId.bind(parent);
    }

    handleOffer(socket: AuthenticatedSocket, data: WebRTCOfferData): void {
        const { targetPeerId, offer } = data;
        if (!targetPeerId || !offer) {
            socket.emit('webrtc-error', { message: 'Invalid offer data' });
            return;
        }
        const targetSocket = this.findSocketByPeerId(targetPeerId);
        if (!targetSocket) {
            socket.emit('webrtc-error', { message: 'Target peer not found' });
            return;
        }
        if (socket.roomId !== targetSocket.roomId) {
            socket.emit('webrtc-error', { message: 'Users not in same room' });
            return;
        }
        targetSocket.emit('webrtc-offer', { fromPeerId: socket.peerId, offer });
    }

    handleAnswer(socket: AuthenticatedSocket, data: WebRTCAnswerData): void {
        const { targetPeerId, answer } = data;
        if (!targetPeerId || !answer) {
            socket.emit('webrtc-error', { message: 'Invalid answer data' });
            return;
        }
        const targetSocket = this.findSocketByPeerId(targetPeerId);
        if (!targetSocket) {
            socket.emit('webrtc-error', { message: 'Target peer not found' });
            return;
        }
        if (socket.roomId !== targetSocket.roomId) {
            socket.emit('webrtc-error', { message: 'Users not in same room' });
            return;
        }
        targetSocket.emit('webrtc-answer', { fromPeerId: socket.peerId, answer });
    }

    handleIceCandidate(socket: AuthenticatedSocket, data: WebRTCIceCandidateData): void {
        const { targetPeerId, candidate } = data;
        if (!targetPeerId || !candidate) {
            socket.emit('webrtc-error', { message: 'Invalid ICE candidate data' });
            return;
        }
        const targetSocket = this.findSocketByPeerId(targetPeerId);
        if (!targetSocket) {
            socket.emit('webrtc-error', { message: 'Target peer not found' });
            return;
        }
        if (socket.roomId !== targetSocket.roomId) {
            socket.emit('webrtc-error', { message: 'Users not in same room' });
            return;
        }
        targetSocket.emit('webrtc-ice-candidate', { fromPeerId: socket.peerId, candidate });
    }
}

export default WebRTCHandler;