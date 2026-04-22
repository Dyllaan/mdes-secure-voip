function isValidRoomId(roomId: string, maxLen: number): boolean {
    const pattern = new RegExp(`^[a-zA-Z0-9_-]{1,${maxLen}}$`);
    return pattern.test(roomId);
}

export { isValidRoomId };