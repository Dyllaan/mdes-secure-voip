/**
 * Bot authentication
 *
 * Handles login against the auth service with retry logic, in-memory token
 * storage, and a background refresh interval to keep the token alive.
 */

import { config } from './config';

const REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

let _token: string | null = null;
let _refreshTimer: NodeJS.Timeout | null = null;

export async function login(): Promise<string> {
    const url  = `${config.AUTH_URL}/user/login`;
    const body = JSON.stringify({ username: config.BOT_USERNAME, password: config.BOT_PASSWORD });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res     = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            const rawBody = await res.text().catch(() => '(could not read body)');

            if (!res.ok) throw new Error(`Auth failed [${res.status}]: ${rawBody}`);

            let data: Record<string, string>;
            try {
                data = JSON.parse(rawBody);
            } catch {
                throw new Error(`Auth response was not JSON: ${rawBody}`);
            }

            const token = data.accessToken ?? data.access_token ?? data.token ?? data.jwt;
            if (!token) throw new Error(`No token found in auth response: ${JSON.stringify(data)}`);

            _token = token;
            return token;
        } catch (err) {
            if (attempt === MAX_RETRIES) throw err;
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