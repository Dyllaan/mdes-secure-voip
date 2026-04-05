import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

export const MOCK_USER = {
  id: 'test-user-id',
  sub: 'test-user-id',
  username: 'testuser',
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  mfaEnabled: false,
};

export const MOCK_HUBS = [
  { id: 'hub-1', name: 'Test Hub One', createdAt: '2024-01-01T00:00:00.000Z', ownerId: 'test-user-id' },
  { id: 'hub-2', name: 'Test Hub Two', createdAt: '2024-02-01T00:00:00.000Z', ownerId: 'test-user-id' },
];

// CORS headers added to every mocked cross-origin (localhost:8080) response
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Auth state helpers

/**
 * Writes MOCK_USER into localStorage via page.evaluate().
 * Call after page has navigated to the app origin.
 */
export async function injectAuthState(page: Page, user = MOCK_USER) {
  await page.evaluate((u) => {
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
}

/**
 * Adds an initScript that writes auth state into localStorage before each
 * navigation. Use this when you need auth state available from the very first
 * page render (e.g. PublicRoute redirect tests).
 */
export async function setAuthState(page: Page, user = MOCK_USER) {
  await page.addInitScript((u) => {
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
}

// IndexedDB setup - satisfies KeysRequired guard

/**
 * Writes a real ECDH keypair into the 'channel-keys-v1' IndexedDB so that
 * KeysRequired sees keys exist and renders children instead of redirecting
 * to /keys.
 *
 * IMPORTANT: The page must already be on the app origin (http://localhost:5173)
 * before calling this, since IDB is origin-scoped. Call after an initial
 * page.goto('/login') to establish the origin.
 */
export async function setupIDB(page: Page) {
  await page.evaluate(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('channel-keys-v1', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('channelKeys')) db.createObjectStore('channelKeys');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(keyPair, 'ecdhKeyPair');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('IDB write failed'));
      };
      req.onerror = () => reject(new Error('IDB open failed'));
    });
  });
}

// ---------------------------------------------------------------------------
// Network route mocks
// ---------------------------------------------------------------------------

/**
 * Mocks the auth service endpoints that AuthProvider calls on every page load:
 *   GET /auth/user/me       -> 200 (token is valid)
 *   POST /auth/user/refresh -> 200 (refresh succeeds)
 *   GET /auth/mfa/status    -> 200 { enabled: false, verified: true }
 */
export async function mockAuthRoutes(page: Page, user = MOCK_USER) {
  await page.route('**/auth/user/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: user.id, username: user.username, mfaEnabled: false }),
    }),
  );

  await page.route('**/auth/user/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    }),
  );

  await page.route('**/auth/mfa/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false, verified: true }),
    }),
  );
}

/**
 * Mocks the hub service via page.route() at the network level.
 *
 * Handles OPTIONS preflight (required for cross-origin Authorization header),
 * then routes by method + URL pattern. The hubList array is mutable so
 * POST /api/hubs updates are visible to subsequent GET /api/hubs calls.
 *
 * Handles:
 *   OPTIONS *                    -> 204 with CORS headers
 *   GET  /api/hubs               -> hubList array
 *   POST /api/hubs               -> create hub (appended to hubList)
 *   POST /api/invites/x/redeem   -> redeem invite -> first hub
 *   All other localhost:8080 requests -> 404 with error JSON
 */
export async function mockHubRoutes(page: Page, hubs = MOCK_HUBS) {
  const hubList = [...hubs];

  await page.route(/localhost:\d+\/hub\//, async (route) => {
    const method = route.request().method();
    const url = route.request().url();

    // Handle CORS preflight (Authorization header triggers OPTIONS)
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    // GET /hub/hubs
    if (method === 'GET' && /\/hub\/hubs$/.test(url)) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(hubList) });
    }

    // POST /hub/hubs - create hub
    if (method === 'POST' && /\/hub\/hubs$/.test(url)) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { name: string };
      const newHub = {
        id: `hub-new-${Date.now()}`,
        name: body.name,
        createdAt: new Date().toISOString(),
        ownerId: 'test-user-id',
      };
      hubList.push(newHub);
      return route.fulfill({ status: 201, headers: CORS, body: JSON.stringify(newHub) });
    }

    // POST /hub/invites/{code}/redeem
    if (method === 'POST' && /\/hub\/invites\/.+\/redeem$/.test(url)) {
      return route.fulfill({
        status: hubList.length > 0 ? 200 : 404,
        headers: CORS,
        body: JSON.stringify({ hub: hubList[0] ?? null }),
      });
    }

    // Fallback
    return route.fulfill({
      status: 404,
      headers: CORS,
      body: JSON.stringify({ error: `Unmocked: ${method} ${url}` }),
    });
  });
}

/**
 * Accepts (and silently drops) all WebSocket connections. Prevents
 * ConnectionProvider from throwing errors when the signaling server
 * is unavailable during tests.
 */
export async function mockWebSocket(page: Page) {
  await page.routeWebSocket(/.*/, (ws) => {
    ws.onMessage(() => { /* no-op */ });
  });
}

/**
 * Mocks Socket.IO HTTP long-polling so the transport doesn't stall
 * waiting for a real server. Works together with mockWebSocket().
 */
export async function mockSocketIO(page: Page) {
  await page.route('**/socket.io/**', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=UTF-8',
        body: '97:0{"sid":"test-sid","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}2:40',
      });
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
}
