function sanitizeInput(input: string): string {
    return input
        .replace(/<[^>]*>/g, '')
        .replace(/[<>'"]/g, '')
        .trim();
}

export { sanitizeInput };