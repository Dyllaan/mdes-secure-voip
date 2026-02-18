function sanitizeInput(input) {
    return input
        .replace(/<[^>]*>/g, '')
        .replace(/[<>'"]/g, '')
        .trim();
}

module.exports = {
    sanitizeInput
};