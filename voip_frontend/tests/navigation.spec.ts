import { test, expect } from '@playwright/test';
import { setAuthState, mockAuthRoutes, setupIDB } from './fixtures/index';

test.describe('Navigation guards', () => {
  test('unauthenticated user visiting / is redirected to /login', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('unauthenticated user visiting /hubs/123 is redirected to /login', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/hubs/123');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('unauthenticated user visiting /keys is redirected to /login', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/keys');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('authenticated user without IDB keys visiting / is redirected to /keys', async ({ page }) => {
    await setAuthState(page);
    await mockAuthRoutes(page);
    await page.goto('/#/');
    await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });
  });

  test('authenticated user with IDB keys visiting /login is redirected to /', async ({ page }) => {
    await setAuthState(page);
    await mockAuthRoutes(page);
    await page.route('**/socket.io/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '' }),
    );
    await page.goto('/#/login');
    await setupIDB(page);
    await page.goto('/#/login');
    await expect(page).toHaveURL(/#\/$/, { timeout: 5000 });
  });

  test('authenticated user with IDB keys visiting /register is redirected to /', async ({ page }) => {
    await setAuthState(page);
    await mockAuthRoutes(page);
    await page.route('**/socket.io/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '' }),
    );
    await page.goto('/#/login');
    await setupIDB(page);
    await page.goto('/#/register');
    await expect(page).toHaveURL(/#\/$/, { timeout: 5000 });
  });

  test('unknown route shows 404 page', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/this-does-not-exist');
    await expect(page.getByText(/not found|404/i)).toBeVisible({ timeout: 3000 });
  });
});