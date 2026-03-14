export function decodeJwt(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = atob(parts[1]);
        return JSON.parse(payload);
    } catch {
        return null;
    }
}