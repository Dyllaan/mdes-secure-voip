import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  bootstrapSignedIn,
  bootstrapSignedInWithKeys,
  connectAppSocket,
  mockAuthRoutes,
  mockHubRoutes,
} from './fixtures/index';

async function expectNoSeriousViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter((violation) =>
    violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(
    violations,
    `${context} has serious/critical accessibility violations:\n${violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join('\n')}`,
  ).toEqual([]);
}

test.describe('Accessibility smoke tests', () => {
  test('login page has no serious or critical axe violations', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/login');

    await expect(page.getByRole('heading', { level: 1, name: 'Login' })).toBeVisible();
    await expect(page).toHaveTitle('MDES | Login');
    await expectNoSeriousViolations(page, 'Login page');
  });

  test('register page keyboard flow reaches the password visibility toggle', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');

    await page.getByTestId('username-input').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('password-input')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show password' }).first()).toBeFocused();
  });

  test('key setup page has no serious or critical axe violations', async ({ page }) => {
    await bootstrapSignedIn(page);

    await expect(page).toHaveURL(/#\/keys$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Set Up Encryption Keys' })).toBeVisible();
    await expect(page).toHaveTitle('MDES | Encryption Keys');
    await expectNoSeriousViolations(page, 'Key setup page');
  });

  test('hub list page supports the skip link and has no serious or critical axe violations', async ({ page }) => {
    await mockHubRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/hub-list');

    await expect(page).toHaveURL(/#\/hub-list$/);
    await expect(page).toHaveTitle('MDES | Hubs');
    await expect(page.getByRole('heading', { level: 1, name: 'Your Hubs' })).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expectNoSeriousViolations(page, 'Hub list page');
  });

  test('profile page has no serious or critical axe violations', async ({ page }) => {
    await mockHubRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/profile');

    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expect(page).toHaveTitle('MDES | Profile');
    await expectNoSeriousViolations(page, 'Profile page');
  });

  test('hub voice and screenshare surfaces have no serious or critical axe violations', async ({ page }) => {
    await mockHubRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await connectAppSocket(page);
    await page.goto('/#/hubs/hub-1');

    await expect(page.getByRole('heading', { level: 1, name: 'Test Hub One' })).toBeVisible();
    await page.getByRole('button', { name: /voice-lobby/i }).click();
    await page.getByRole('button', { name: 'Screen sharing' }).click();

    await expect(page.locator('#hub-main')).toBeVisible();
    await expect(page).toHaveTitle('MDES | Hub');
    await expectNoSeriousViolations(page, 'Hub voice and screenshare view');
  });
});
