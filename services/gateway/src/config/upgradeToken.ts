import http from 'http';
import { URL } from 'url';

/**
 * Extract a JWT from an HTTP upgrade request.
 * Checks Authorization header first, then ?token= query param.
 * Returns null if no token is present (not the same as an invalid token).
 */
export function extractUpgradeToken(req: http.IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const t = url.searchParams.get('token');
    if (t) return t;
  } catch { /* ignore malformed URLs */ }
  return null;
}

export function extractRequestToken(url: string | undefined, authorization: string | undefined): string | null {
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    return token || null;
  }

  try {
    const parsed = new URL(url ?? '/', 'http://localhost');
    const token = parsed.searchParams.get('token');
    return token || null;
  } catch {
    return null;
  }
}
