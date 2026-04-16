import { test, expect } from '@playwright/test';
import {
  MOCK_MFA_USER,
  MOCK_USER,
  bootstrapProfilePage,
  mockHubRoutes,
  mockProfileRoutes,
} from './fixtures/index';

async function setupProfilePage(page: Parameters<typeof bootstrapProfilePage>[0], user = MOCK_USER) {
  await mockHubRoutes(page);
  await bootstrapProfilePage(page, user);
}

test.describe('Profile page', () => {
  test('opens profile for a keyed signed-in user', async ({ page }) => {
    await setupProfilePage(page);
    await expect(page).toHaveURL(/#\/profile$/);
    await expect(page.getByText('MFA is Disabled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  });

  test('MFA-disabled state can complete MFA setup flow', async ({ page }) => {
    await mockProfileRoutes(page);
    await setupProfilePage(page);

    await page.getByText('MFA is Disabled').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Scan QR Code')).toBeVisible();

    await page.locator('#verifyCode').fill('123456');
    await page.getByRole('button', { name: 'Verify & Enable' }).click();

    await expect(page.getByText(/Important: Save Your Backup Codes/i)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('MFA is Enabled')).toBeVisible();
  });

  test('MFA-enabled state can disable MFA', async ({ page }) => {
    await mockProfileRoutes(page);
    await setupProfilePage(page, MOCK_MFA_USER);

    await page.getByText('MFA is Enabled').click();
    await expect(page.getByText('Disable Two-Factor Authentication')).toBeVisible();

    await page.locator('#verifyCode').fill('123456');
    await page.getByRole('button', { name: 'Verify & Disable' }).click();

    await expect(page.getByText('MFA is Disabled')).toBeVisible();
  });

  test('invalid MFA disable code shows feedback and keeps dialog open', async ({ page }) => {
    await mockProfileRoutes(page, { disableMfaSuccess: false });
    await setupProfilePage(page, MOCK_MFA_USER);

    await page.getByText('MFA is Enabled').click();
    await page.locator('#verifyCode').fill('123456');
    await page.getByRole('button', { name: 'Verify & Disable' }).click();

    await expect(page.getByText('Disable Two-Factor Authentication')).toBeVisible();
    await expect(page.locator('#verifyCode')).toBeEnabled();
    await expect(page.locator('#verifyCode')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Verify & Disable' })).toBeDisabled();
  });

  test('password validation errors appear before submit', async ({ page }) => {
    await mockProfileRoutes(page);
    await setupProfilePage(page);

    await page.getByRole('button', { name: /Change Password/i }).click();
    await page.locator('#current-password').fill('OldPass1');
    await page.locator('#new-password').fill('short');
    await page.locator('#confirm-password').fill('different');

    await expect(page.getByText('Password is too short')).toBeVisible();
    await expect(page.getByText('Password must contain at least one uppercase letter')).toBeVisible();
    await expect(page.getByText('New password and confirmation do not match')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update Password' })).toBeDisabled();
  });

  test('password update success closes the form', async ({ page }) => {
    await mockProfileRoutes(page, { updatePasswordResponse: { status: 200, body: {} } });
    await setupProfilePage(page);

    await page.getByRole('button', { name: /Change Password/i }).click();
    await page.locator('#current-password').fill('OldPass1');
    await page.locator('#new-password').fill('NewPassword1');
    await page.locator('#confirm-password').fill('NewPassword1');
    await page.getByRole('button', { name: 'Update Password' }).click();

    await expect(page.getByRole('button', { name: 'Update Password' })).not.toBeVisible();
    await expect(page.getByText('Password updated successfully').first()).toBeVisible();
  });

  test('password update can require MFA input for a non-MFA-enabled account', async ({ page }) => {
    await mockProfileRoutes(page, { updatePasswordResponse: { status: 400, body: { cause: 'MFA code required' } } });
    await setupProfilePage(page);

    await page.getByRole('button', { name: /Change Password/i }).click();
    await page.locator('#current-password').fill('OldPass1');
    await page.locator('#new-password').fill('NewPassword1');
    await page.locator('#confirm-password').fill('NewPassword1');
    await page.getByRole('button', { name: 'Update Password' }).click();

    await expect(page.getByText(/MFA code is required/i)).toBeVisible();
  });

  test('delete account without MFA logs the user out', async ({ page }) => {
    await mockProfileRoutes(page, { deleteUserResponse: { status: 200, body: {} } });
    await setupProfilePage(page);

    await page.getByText('Confirm Delete Account').click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page).toHaveURL(/#\/login$/, { timeout: 5000 });
  });

  test('delete account with MFA requires a code and logs the user out', async ({ page }) => {
    await mockProfileRoutes(page, { deleteUserResponse: { status: 200, body: {} } });
    await setupProfilePage(page, MOCK_MFA_USER);

    await page.getByText('Delete Account').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.locator('#verifyCode').fill('123456');
    await page.getByRole('button', { name: 'Verify & Delete Account' }).click();

    await expect(page).toHaveURL(/#\/login$/, { timeout: 5000 });
  });

  test('logout from profile returns the user to login and blocks protected routes', async ({ page }) => {
    await mockProfileRoutes(page);
    await setupProfilePage(page);

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/#\/login$/, { timeout: 5000 });

    await page.goto('/#/profile');
    await page.reload();
    await expect(page).toHaveURL(/#\/login$/, { timeout: 5000 });
  });
});
