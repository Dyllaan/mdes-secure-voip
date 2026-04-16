import { test, expect } from '@playwright/test';
import {
  MOCK_HUBS,
  bootstrapSignedInWithKeys,
  mockHubRoutes,
} from './fixtures/index';

const VALID_INVITE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function setupHubListPage(
  page: Parameters<typeof bootstrapSignedInWithKeys>[0],
  hubs = MOCK_HUBS,
) {
  await mockHubRoutes(page, hubs);
  await bootstrapSignedInWithKeys(page);
}

test.describe('Hub list page', () => {
  test.describe.configure({ mode: 'serial' });

  test('displays list of hubs from API', async ({ page }) => {
    await setupHubListPage(page);
    await page.goto('/#/hub-list');
    for (const hub of MOCK_HUBS) {
      await expect(page.getByText(hub.name)).toBeVisible({ timeout: 5000 });
    }
  });

  test('shows empty state when user has no hubs', async ({ page }) => {
    await setupHubListPage(page, []);
    await page.goto('/#/hub-list');
    await expect(page.getByText(/no hubs yet/i)).toBeVisible({ timeout: 5000 });
  });

  test('Create button is disabled when hub name input is empty', async ({ page }) => {
    await setupHubListPage(page);
    await page.goto('/#/hub-list');
    await expect(page.getByTestId('hub-name-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('create-hub-button')).toBeDisabled();
  });

  test('Create button is enabled after typing a hub name', async ({ page }) => {
    await setupHubListPage(page);
    await page.goto('/#/hub-list');
    await page.getByTestId('hub-name-input').fill('My New Hub');
    await expect(page.getByTestId('create-hub-button')).toBeEnabled();
  });

  test('creating a hub adds it to the list', async ({ page }) => {
    await setupHubListPage(page, []);
    await page.goto('/#/hub-list');
    await expect(page.getByText(/no hubs yet/i)).toBeVisible({ timeout: 5000 });
    await page.getByTestId('hub-name-input').fill('Brand New Hub');
    await page.getByTestId('create-hub-button').click();
    await expect(page.getByText('Brand New Hub')).toBeVisible({ timeout: 5000 });
  });

  test('pressing Enter in hub name input creates the hub', async ({ page }) => {
    await setupHubListPage(page, []);
    await page.goto('/#/hub-list');
    await page.getByTestId('hub-name-input').fill('Enter Key Hub');
    await page.getByTestId('hub-name-input').press('Enter');
    await expect(page.getByText('Enter Key Hub')).toBeVisible({ timeout: 5000 });
  });

  test('create hub API error shows error message', async ({ page }) => {
    await page.route(/localhost:\d+\/hub\//, async (route) => {
      const method = route.request().method();
      const pathname = new URL(route.request().url()).pathname;
      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
      }
      if (method === 'GET' && /\/hub\/hubs$/.test(pathname)) {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      }
      if (method === 'POST' && /\/hub\/hubs$/.test(pathname)) {
        return route.abort('failed');
      }
      return route.fulfill({ status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    });
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/hub-list');
    await page.getByTestId('hub-name-input').fill('Failing Hub');
    await page.getByTestId('create-hub-button').click();
    await expect(page.getByText(/network error/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('Join button is disabled when invite input is empty', async ({ page }) => {
    await setupHubListPage(page, []);
    await page.goto('/#/hub-list');
    await expect(page.getByTestId('invite-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('join-hub-button')).toBeDisabled();
  });

  test('Join button is enabled after typing an invite code', async ({ page }) => {
    await setupHubListPage(page, []);
    await page.goto('/#/hub-list');
    await page.getByTestId('invite-input').fill(VALID_INVITE);
    await expect(page.getByTestId('join-hub-button')).toBeEnabled();
  });

  test('redeeming an invite code navigates to the hub', async ({ page }) => {
    await setupHubListPage(page);
    await page.goto('/#/hub-list');
    await page.getByTestId('invite-input').fill(VALID_INVITE);
    await page.getByTestId('join-hub-button').click();
    await expect(page).toHaveURL(/#\/hubs\/hub-1$/, { timeout: 5000 });
  });

  test('invalid invite code shows error message', async ({ page }) => {
    await page.route(/localhost:\d+\/hub\//, async (route) => {
      const method = route.request().method();
      const pathname = new URL(route.request().url()).pathname;
      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
      }
      if (method === 'GET' && /\/hub\/hubs$/.test(pathname)) {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      }
      if (method === 'POST' && /\/hub\/invites\/.+\/redeem$/.test(pathname)) {
        return route.abort('failed');
      }
      return route.fulfill({ status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    });
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/hub-list');
    await page.getByTestId('invite-input').fill(VALID_INVITE);
    await page.getByTestId('join-hub-button').click();
    await expect(page.getByText(/network error/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('invalid invite format is rejected on the client', async ({ page }) => {
    await setupHubListPage(page, []);
    await page.goto('/#/hub-list');
    await page.getByTestId('invite-input').fill('bad-code');
    await page.getByTestId('join-hub-button').click();
    await expect(page.getByText('Invalid invite code format')).toBeVisible({ timeout: 5000 });
  });

  test('clicking a hub item navigates to the hub page', async ({ page }) => {
    await setupHubListPage(page);
    await page.goto('/#/hub-list');
    await expect(page.getByTestId('hub-item').first()).toBeVisible({ timeout: 5000 });
    await page.getByTestId('hub-item').first().click();
    await expect(page).toHaveURL(/#\/hubs\/hub-1$/, { timeout: 5000 });
  });

  test('page shows the correct hub count', async ({ page }) => {
    await setupHubListPage(page);
    await page.goto('/#/hub-list');
    const hubItems = page.getByTestId('hub-item');
    await expect(hubItems.first()).toBeVisible({ timeout: 5000 });
    await expect(hubItems).toHaveCount(MOCK_HUBS.length, { timeout: 5000 });
  });
});
