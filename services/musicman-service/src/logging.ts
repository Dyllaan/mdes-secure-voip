export function truncateForLog(value: string | undefined, max = 160): string | undefined {
    if (value === undefined) return undefined;
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(0, max - 3))}...`;
}

export function formatErrorForLog(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack,
        };
    }

    return { message: String(error) };
}

export function appendStderrLines(lines: string[], chunk: Buffer | string, maxLines = 6): void {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push(trimmed);
        if (lines.length > maxLines) lines.shift();
    }
}

export function summarizeStderrLines(lines: string[]): string | null {
    return lines.length > 0 ? lines.join(' | ') : null;
}
