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
