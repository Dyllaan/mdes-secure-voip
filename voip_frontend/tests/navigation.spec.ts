import { test, expect } from '@playwright/test';
import {
  bootstrapSignedOut,
  bootstrapSignedIn,
  bootstrapSignedInWithKeys,
  mockHubRoutes,
} from './fixtures/index';

test.describe('Navigation guards', () => {
  test('signed-out root shows the landing page', async ({ page }) => {
    await bootstrapSignedOut(page);
    await page.goto('/#/');
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  });

  test('unauthenticated user visiting /hubs/123 is redirected to /login', async ({ page }) => {
    await bootstrapSignedOut(page);
    await page.goto('/#/hubs/123');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('unauthenticated user visiting /keys is redirected to /login', async ({ page }) => {
    await bootstrapSignedOut(page);
    await page.goto('/#/keys');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('authenticated user without IDB keys visiting /hub-list is redirected to /keys', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/hub-list');
    await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });
  });

  test('authenticated user with IDB keys visiting /login is redirected to /hub-list', async ({ page }) => {
    await mockHubRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/login');
    await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 5000 });
  });

  test('authenticated user with IDB keys visiting /register is redirected to /hub-list', async ({ page }) => {
    await mockHubRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/register');
    await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 5000 });
  });

  test('authenticated keyed user can open a protected hub route', async ({ page }) => {
    await mockHubRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/hubs/hub-1');
    await expect(page).toHaveURL(/#\/hubs\/hub-1$/, { timeout: 5000 });
    await expect(page.getByText('Test Hub One')).toBeVisible({ timeout: 5000 });
  });

  test('unknown route shows 404 page', async ({ page }) => {
    await bootstrapSignedOut(page);
    await page.goto('/#/this-does-not-exist');
    await expect(page.getByText(/not found|404/i)).toBeVisible({ timeout: 3000 });
  });
});
