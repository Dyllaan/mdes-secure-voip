import { test, expect } from '@playwright/test';
import {
  MOCK_HUBS,
  MOCK_USER,
  injectAuthState,
  mockAuthRoutes,
  setupIDB,
  mockHubRoutes,
  mockSocketIO,
  mockWebSocket,
} from './fixtures/index';

// ---------------------------------------------------------------------------
// Before each hub test:
//  1. Set up route mocks (persist across navigations within the same test).
//  2. Navigate to /login WITHOUT auth to establish the origin.
//  3. Write IDB keypair via evaluate() — fully awaited, no race condition.
//  4. Inject auth state into localStorage.
//  Subsequent page.goto('/') will now find auth + IDB and render HubList.
// ---------------------------------------------------------------------------
async function setupHubsPage(page: Parameters<typeof injectAuthState>[0]) {
  await mockAuthRoutes(page);
  await mockSocketIO(page);
  await mockWebSocket(page);

  // Navigate to the origin without auth (stays on /login)
  await page.goto('/login');

  // Set up IDB — must be called while on the origin
  await setupIDB(page);

  // Set auth state in localStorage — AuthProvider reads this on next navigation
  await injectAuthState(page);
}

test.describe('Hub list page', () => {
  test('displays list of hubs from API', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page);

    await page.goto('/');

    for (const hub of MOCK_HUBS) {
      await expect(page.getByText(hub.name)).toBeVisible({ timeout: 5000 });
    }
  });

  test('shows empty state when user has no hubs', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page, []);

    await page.goto('/');

    await expect(page.getByText(/no hubs yet/i)).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Create hub
  // -------------------------------------------------------------------------
  test('Create button is disabled when hub name input is empty', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page);

    await page.goto('/');
    await expect(page.getByTestId('hub-name-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('create-hub-button')).toBeDisabled();
  });

  test('Create button is enabled after typing a hub name', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page);

    await page.goto('/');
    await page.getByTestId('hub-name-input').fill('My New Hub');
    await expect(page.getByTestId('create-hub-button')).toBeEnabled();
  });

  test('creating a hub adds it to the list', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page, []); // start with empty hub list

    await page.goto('/');
    await expect(page.getByText(/no hubs yet/i)).toBeVisible({ timeout: 5000 });

    await page.getByTestId('hub-name-input').fill('Brand New Hub');
    await page.getByTestId('create-hub-button').click();

    await expect(page.getByText('Brand New Hub')).toBeVisible({ timeout: 5000 });
  });

  test('pressing Enter in hub name input creates the hub', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page, []);

    await page.goto('/');
    await page.getByTestId('hub-name-input').fill('Enter Key Hub');
    await page.getByTestId('hub-name-input').press('Enter');

    await expect(page.getByText('Enter Key Hub')).toBeVisible({ timeout: 5000 });
  });

  test('create hub API error shows error message', async ({ page }) => {
    await setupHubsPage(page);
    await page.route(/localhost:\d+\/hub\//, async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
      }
      if (method === 'GET' && /\/hub\/hubs$/.test(url)) {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      }
      // POST (create) returns 500
      return route.fulfill({ status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Internal server error' }) });
    });

    await page.goto('/');
    await page.getByTestId('hub-name-input').fill('Failing Hub');
    await page.getByTestId('create-hub-button').click();

    await expect(page.getByTestId('hub-error')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Join hub via invite
  // -------------------------------------------------------------------------
  test('Join button is disabled when invite input is empty', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page, []);

    await page.goto('/');
    await expect(page.getByTestId('invite-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('join-hub-button')).toBeDisabled();
  });

  test('Join button is enabled after typing an invite code', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page, []);

    await page.goto('/');
    await page.getByTestId('invite-input').fill('INVITE-CODE-123');
    await expect(page.getByTestId('join-hub-button')).toBeEnabled();
  });

  test('redeeming an invite code navigates to the hub', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page);

    await page.goto('/');
    await page.getByTestId('invite-input').fill('VALID-INVITE');
    await page.getByTestId('join-hub-button').click();

    await expect(page).toHaveURL(/\/hubs\/hub-1$/, { timeout: 5000 });
  });

  test('invalid invite code shows error message', async ({ page }) => {
    await setupHubsPage(page);
    // Override the hub service catch-all to make invites/redeem return an error
    await page.route(/localhost:\d+\/hub\//, async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
      }
      if (method === 'GET' && /\/hub\/hubs$/.test(url)) {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      }
      if (method === 'POST' && /\/hub\/invites\/.+\/redeem$/.test(url)) {
        return route.fulfill({ status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid invite code' }) });
      }
      return route.fulfill({ status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    });

    await page.goto('/');
    await page.getByTestId('invite-input').fill('BAD-CODE');
    await page.getByTestId('join-hub-button').click();

    await expect(page.getByTestId('hub-error')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Hub list item navigation
  // -------------------------------------------------------------------------
  test('clicking a hub item navigates to the hub page', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page);

    await page.goto('/');
    await expect(page.getByTestId('hub-item').first()).toBeVisible({ timeout: 5000 });
    await page.getByTestId('hub-item').first().click();

    await expect(page).toHaveURL(/\/hubs\/hub-1$/, { timeout: 5000 });
  });

  test('page shows the correct hub count', async ({ page }) => {
    await setupHubsPage(page);
    await mockHubRoutes(page);

    await page.goto('/');

    const hubItems = page.getByTestId('hub-item');
    await expect(hubItems).toHaveCount(MOCK_HUBS.length, { timeout: 5000 });
  });
});
