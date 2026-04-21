type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SerializedError {
    name?: string;
    message: string;
    stack?: string;
    code?: string;
    cause?: SerializedError | string;
}

type LogValue = Record<string, unknown>;

const SECRET_KEY_PATTERN = /(authorization|token|secret|password|credential|cookie|jwt|signature|api[-_]?key|access[-_]?key)/i;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const MAX_DEPTH = 5;
const MAX_ARRAY_LENGTH = 20;

export function parseBooleanish(value: string | undefined): boolean {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function truncateForLog(value: string | undefined, max = 160): string | undefined {
    if (value === undefined) return undefined;
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(0, max - 3))}...`;
}

export function sanitizeUrlForLog(rawUrl: string | undefined, max = 220): string | undefined {
    if (!rawUrl) return rawUrl;

    try {
        const parsed = new URL(rawUrl);
        for (const key of [...parsed.searchParams.keys()]) {
            if (SECRET_KEY_PATTERN.test(key)) {
                parsed.searchParams.set(key, redactStringValue(parsed.searchParams.get(key)));
            }
        }
        return truncateForLog(parsed.toString(), max);
    } catch {
        return truncateForLog(rawUrl, max);
    }
}

export function redactStringValue(value: string | null | undefined): string {
    if (!value) return '[REDACTED]';
    return `[REDACTED len=${value.length}]`;
}

export function describeSecret(value: string | null | undefined): string {
    return value ? `present(len=${value.length})` : 'missing';
}

export function formatErrorForLog(error: unknown): SerializedError {
    if (error instanceof Error) {
        const errno = error as NodeJS.ErrnoException;
        const serialized: SerializedError = {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };

        if (typeof errno.code === 'string') serialized.code = errno.code;

        if ('cause' in error && error.cause !== undefined) {
            serialized.cause = error.cause instanceof Error
                ? formatErrorForLog(error.cause)
                : String(error.cause);
        }

        return serialized;
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

function sanitizePrimitive(value: string | number | boolean | null, key?: string): unknown {
    if (typeof value === 'string') {
        if (key && SECRET_KEY_PATTERN.test(key)) return redactStringValue(value);
        if (URL_PATTERN.test(value)) return sanitizeUrlForLog(value);
        return truncateForLog(value, 1_000);
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
        return String(value);
    }

    return value;
}

function sanitizeValue(value: unknown, key?: string, depth = 0): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return sanitizePrimitive(value, key);
    }

    if (value === undefined) return undefined;
    if (value instanceof Error) return formatErrorForLog(value);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return { type: 'Buffer', length: value.length };
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;

    if (depth >= MAX_DEPTH) return '[Truncated]';

    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitizeValue(entry, key, depth + 1));
    }

    if (value instanceof Date) return value.toISOString();
    if (value instanceof URL) return sanitizeUrlForLog(value.toString());

    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value as LogValue)) {
            const sanitized = sanitizeValue(childValue, childKey, depth + 1);
            if (sanitized !== undefined) out[childKey] = sanitized;
        }
        return out;
    }

    return String(value);
}

function sanitizeFields(fields: LogValue | undefined): Record<string, unknown> {
    if (!fields) return {};
    return sanitizeValue(fields) as Record<string, unknown>;
}

function writeJson(level: LogLevel, payload: Record<string, unknown>): void {
    const line = `${JSON.stringify(payload)}\n`;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(line);
}

function isDebugEnabled(): boolean {
    return parseBooleanish(process.env.DEBUG);
}

export interface Logger {
    debug(message: string, fields?: LogValue): void;
    info(message: string, fields?: LogValue): void;
    warn(message: string, fields?: LogValue): void;
    error(message: string, fields?: LogValue): void;
    child(context: string, fields?: LogValue): Logger;
}

class JsonLogger implements Logger {
    constructor(
        private readonly context: string,
        private readonly baseFields: LogValue = {},
    ) {}

    debug(message: string, fields?: LogValue): void {
        if (!isDebugEnabled()) return;
        this.write('debug', message, fields);
    }

    info(message: string, fields?: LogValue): void {
        this.write('info', message, fields);
    }

    warn(message: string, fields?: LogValue): void {
        this.write('warn', message, fields);
    }

    error(message: string, fields?: LogValue): void {
        this.write('error', message, fields);
    }

    child(context: string, fields?: LogValue): Logger {
        return new JsonLogger(
            `${this.context}.${context}`,
            {
                ...this.baseFields,
                ...fields,
            },
        );
    }

    private write(level: LogLevel, message: string, fields?: LogValue): void {
        writeJson(level, {
            timestamp: new Date().toISOString(),
            level,
            message,
            context: this.context,
            ...sanitizeFields(this.baseFields),
            ...sanitizeFields(fields),
        });
    }
}

export function createLogger(context: string, fields?: LogValue): Logger {
    return new JsonLogger(context, fields);
}
