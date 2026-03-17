import { config } from './config';

const REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

let _token: string | null = null;
let _refreshTimer: NodeJS.Timeout | null = null;

/**
 * Attempt to login with the environment credentials, retrying up to MAX_RETRIES times with a delay between attempts.
 * On success, stores the token in memory and returns it
 */
export async function login(): Promise<string> {
  const url  = `${config.AUTH_URL}/user/login`;
  const body = JSON.stringify({
    username: config.BOT_USERNAME,
    password: config.BOT_PASSWORD,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[Auth] POST ${url} (attempt ${attempt}/${MAX_RETRIES})`);
    console.log('[Auth] Request body:', JSON.stringify({
      username: config.BOT_USERNAME,
      password: '***',
    }));

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const rawBody = await res.text().catch(() => '(could not read body)');
      console.log(`[Auth] Response: ${res.status} ${res.statusText}`);
      console.log('[Auth] Response headers:', Object.fromEntries(res.headers.entries()));
      console.log('[Auth] Response body:', rawBody);

      if (!res.ok) {
        throw new Error(`Auth failed [${res.status}]: ${rawBody}`);
      }

      let data: Record<string, string>;
      try {
        data = JSON.parse(rawBody);
      } catch {
        throw new Error(`Auth response was not JSON: ${rawBody}`);
      }

      const token: string =
        data.accessToken ??
        data.access_token ??
        data.token ??
        data.jwt;

      if (!token) {
        throw new Error(`No token found in auth response: ${JSON.stringify(data)}`);
      }

      _token = token;
      console.log('[Auth] Token acquired ✓');
      return token;

    } catch (err) {
      console.warn(`[Auth] Attempt ${attempt} failed:`, (err as Error).message);
      if (attempt === MAX_RETRIES) throw err;
      console.log(`[Auth] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
    }
  }

  throw new Error('Login failed after all retries');
}

export function getToken(): string {
  if (!_token) throw new Error('Not authenticated - call login() first');
  return _token;
}

export function startTokenRefresh(): void {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(async () => {
    try {
      await login();
      console.log('[Auth] Token refreshed');
    } catch (err) {
      console.error('[Auth] Background token refresh failed:', err);
    }
  }, REFRESH_INTERVAL_MS);
}

export function stopTokenRefresh(): void {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}