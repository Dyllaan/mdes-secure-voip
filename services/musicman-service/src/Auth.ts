import { config } from './config';
import { createLogger, describeSecret, formatErrorForLog, truncateForLog } from './logging';

const REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 30000;
const authLog = createLogger('auth');

let _token: string | null = null;
let _refreshTimer: NodeJS.Timeout | null = null;
let _turnCredentials: { username: string; password: string; ttl: number } | null = null;

export async function register(): Promise<void> {
    const url  = `${config.AUTH_URL}/user/register`;
    const body = JSON.stringify({ username: config.BOT_USERNAME, password: config.BOT_PASSWORD });
    const registerLog = authLog.child('register', {
        url,
        username: config.BOT_USERNAME,
        password: describeSecret(config.BOT_PASSWORD),
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            registerLog.info('register.attempt.start', { attempt, maxRetries: MAX_RETRIES });
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

            if (res.status === 409) {
                registerLog.info('register.already_exists', { attempt, status: res.status });
                return;
            }

            if (res.ok) {
                registerLog.info('register.success', { attempt, status: res.status });
                return;
            }

            const rawBody = await res.text().catch(() => '(could not read body)');
            throw new Error(`Bot registration failed [${res.status}]: ${rawBody}`);
        } catch (err) {
            registerLog.error('register.attempt.failed', {
                attempt,
                willRetry: attempt < MAX_RETRIES,
                nextDelayMs: attempt < MAX_RETRIES ? RETRY_DELAY_MS : 0,
                error: formatErrorForLog(err),
            });
            if (attempt === MAX_RETRIES) throw err;
            await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
        }
    }

    throw new Error('Registration failed after all retries');
}

export async function login(): Promise<string> {
    const url  = `${config.AUTH_URL}/user/bot-login`;
    const body = JSON.stringify({ username: config.BOT_USERNAME });
    const loginLog = authLog.child('login', {
        url,
        username: config.BOT_USERNAME,
        botSecret: describeSecret(config.BOT_SECRET),
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const delayMs = Math.min(RETRY_DELAY_MS * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS);
        try {
            loginLog.info('login.attempt.start', {
                attempt,
                maxRetries: MAX_RETRIES,
            });
            const res     = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Bot-Secret': config.BOT_SECRET,
                },
                body,
            });
            const rawBody = await res.text().catch(() => '(could not read body)');

            loginLog.info('login.attempt.response', {
                attempt,
                status: res.status,
                ok: res.ok,
                bodyPreview: truncateForLog(rawBody, 220),
            });

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
            loginLog.info('login.success', {
                attempt,
                tokenLength: token.length,
            });
            return token;
        } catch (err) {
            loginLog.error('login.attempt.failed', {
                attempt,
                willRetry: attempt < MAX_RETRIES,
                nextDelayMs: attempt < MAX_RETRIES ? delayMs : 0,
                error: formatErrorForLog(err),
            });
            if (attempt === MAX_RETRIES) throw err;
            await new Promise(res => setTimeout(res, delayMs));
        }
    }

    throw new Error('Login failed after all retries');
}

export async function fetchTurnCredentials(): Promise<void> {
    if (!_token) throw new Error('Not authenticated - call login() first');

    const turnLog = authLog.child('turnCredentials', {
        url: `${config.GATEWAY_URL}/turn-credentials`,
        turnHost: config.TURN_HOST,
        turnPort: config.TURN_PORT,
        turnSecure: config.TURN_SECURE,
        tokenLength: _token.length,
    });
    turnLog.info('turn_credentials.fetch.start');

    const res = await fetch(`${config.GATEWAY_URL}/turn-credentials`, {
        headers: { Authorization: `Bearer ${_token}` },
    });

    if (!res.ok) {
        const rawBody = typeof res.text === 'function'
            ? await res.text().catch(() => '(could not read body)')
            : '(could not read body)';
        turnLog.error('turn_credentials.fetch.failed', {
            status: res.status,
            bodyPreview: truncateForLog(rawBody, 220),
        });
        throw new Error(`Failed to fetch TURN credentials [${res.status}]: ${rawBody}`);
    }

    const data = await res.json() as { username: string; password: string; ttl: number };
    _turnCredentials = data;
    turnLog.info('turn_credentials.fetch.success', {
        usernamePreview: truncateForLog(data.username, 80),
        ttlSeconds: data.ttl,
        password: describeSecret(data.password),
    });
}

export function getToken(): string {
    if (!_token) throw new Error('Not authenticated - call login() first');
    return _token;
}

export function getTurnCredentials(): { username: string; password: string; ttl: number } {
    if (!_turnCredentials) throw new Error('TURN credentials not fetched - call fetchTurnCredentials() first');
    return _turnCredentials;
}

export function startTokenRefresh(): void {
    if (_refreshTimer) {
        authLog.info('token_refresh.already_running');
        return;
    }
    authLog.info('token_refresh.start', {
        intervalMs: REFRESH_INTERVAL_MS,
    });
    _refreshTimer = setInterval(async () => {
        try {
            authLog.info('token_refresh.tick.start');
            await login();
            await fetchTurnCredentials();
            authLog.info('token_refresh.tick.complete');
        } catch (err) {
            authLog.error('token_refresh.tick.failed', {
                error: formatErrorForLog(err),
            });
        }
    }, REFRESH_INTERVAL_MS);
}

export function stopTokenRefresh(): void {
    if (_refreshTimer) {
        authLog.info('token_refresh.stop');
        clearInterval(_refreshTimer);
        _refreshTimer = null;
    }
}
