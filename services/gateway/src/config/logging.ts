import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import pino from 'pino';

const REDACTED = '[Redacted]';
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-bot-secret',
]);

function sanitiseHeaderValue(name: string, value: unknown): unknown {
  return SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
}

export function sanitiseHeaders(headers?: IncomingHttpHeaders | Record<string, unknown>): Record<string, unknown> | undefined {
  if (!headers) return undefined;

  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, sanitiseHeaderValue(name, value)]),
  );
}

export function sanitiseQuery(query?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!query) return undefined;

  return Object.fromEntries(
    Object.entries(query).map(([name, value]) => [name, name.toLowerCase() === 'token' ? REDACTED : value]),
  );
}

export function sanitiseUrlForLogs(url?: string): string | undefined {
  if (!url) return url;

  try {
    const parsed = new URL(url, 'http://localhost');
    parsed.searchParams.delete('token');
    const query = parsed.searchParams.toString();
    return `${parsed.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return url.replace(/([?&])token=[^&]*/gi, '$1token=[Redacted]').replace(/[?&]$/, '');
  }
}

export function serialiseRequestForLogs(req: IncomingMessage) {
  const serialised = pino.stdSerializers.req(req) as unknown as Record<string, unknown>;
  const url = typeof serialised.url === 'string' ? serialised.url : req.url;
  serialised.url = sanitiseUrlForLogs(url);
  serialised.headers = sanitiseHeaders(serialised.headers as Record<string, unknown> | undefined);
  serialised.query = sanitiseQuery(serialised.query as Record<string, unknown> | undefined);
  return serialised;
}

export function serialiseResponseForLogs(res: ServerResponse) {
  const serialised = pino.stdSerializers.res(res) as unknown as Record<string, unknown>;
  serialised.headers = sanitiseHeaders(serialised.headers as Record<string, unknown> | undefined);
  return serialised;
}
