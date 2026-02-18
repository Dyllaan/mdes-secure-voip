const crypto = require('crypto');

function generateRoomId() {
    return crypto.randomBytes(6).toString('base64url');
}

module.exports = {
    generateRoomId,
};