class WebRTCHandler {
    constructor(parent) {
        this.findSocketByPeerId = parent.findSocketByPeerId.bind(parent);
    }

    handleOffer(socket, data) {
        const { targetPeerId, offer } = data;

        if (!targetPeerId || !offer) {
            return socket.emit('webrtc-error', { message: 'Invalid offer data' });
        }

        const targetSocket = this.findSocketByPeerId(targetPeerId);

        if (!targetSocket) {
            return socket.emit('webrtc-error', { message: 'Target peer not found' });
        }

        if (socket.roomId !== targetSocket.roomId) {
            return socket.emit('webrtc-error', { message: 'Users not in same room' });
        }

        targetSocket.emit('webrtc-offer', { fromPeerId: socket.peerId, offer });
    }

    handleAnswer(socket, data) {
        const { targetPeerId, answer } = data;

        if (!targetPeerId || !answer) {
            return socket.emit('webrtc-error', { message: 'Invalid answer data' });
        }

        const targetSocket = this.findSocketByPeerId(targetPeerId);

        if (!targetSocket) {
            return socket.emit('webrtc-error', { message: 'Target peer not found' });
        }

        if (socket.roomId !== targetSocket.roomId) {
            return socket.emit('webrtc-error', { message: 'Users not in same room' });
        }

        targetSocket.emit('webrtc-answer', { fromPeerId: socket.peerId, answer });
    }

    handleIceCandidate(socket, data) {
        const { targetPeerId, candidate } = data;

        if (!targetPeerId || !candidate) {
            return socket.emit('webrtc-error', { message: 'Invalid ICE candidate data' });
        }

        const targetSocket = this.findSocketByPeerId(targetPeerId);

        if (!targetSocket) {
            return socket.emit('webrtc-error', { message: 'Target peer not found' });
        }

        if (socket.roomId !== targetSocket.roomId) {
            return socket.emit('webrtc-error', { message: 'Users not in same room' });
        }

        targetSocket.emit('webrtc-ice-candidate', { fromPeerId: socket.peerId, candidate });
    }
}

module.exports = WebRTCHandler;