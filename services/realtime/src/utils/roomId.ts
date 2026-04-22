import crypto from 'crypto';

function generateRoomId() {
    return crypto.randomBytes(6).toString('base64url');
}

export { generateRoomId };