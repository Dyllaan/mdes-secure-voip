const config = require('../config');

function isValidRoomId(roomId, maxLen) {
    const pattern = new RegExp(`^[a-zA-Z0-9_-]{1,${maxLen}}$`);
    return pattern.test(roomId);
}

module.exports = {
    isValidRoomId
};