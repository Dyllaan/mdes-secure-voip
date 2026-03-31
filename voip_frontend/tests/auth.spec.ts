import { test, expect } from '@playwright/test';
import { MOCK_USER, mockAuthRoutes } from './fixtures/index';

test.describe('Auth - Login page', () => {
  test('renders username, password inputs and Sign In button', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.getByTestId('username-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('toggle to register mode shows register form', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/login');
    await page.getByTestId('switch-to-register').click();
    await expect(page.getByTestId('register-submit')).toBeVisible();
    await expect(page.getByTestId('confirm-password-input')).toBeVisible();
  });

  test('successful login redirects off the login page', async ({ page }) => {
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      }),
    );
    await mockAuthRoutes(page);

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/#\/(keys)?$/, { timeout: 5000 });
  });

  test('login failure shows error message', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ cause: 'Invalid username or password' }),
      }),
    );

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('wronguser');
    await page.getByTestId('password-input').fill('wrongpass');
    await page.getByTestId('login-submit').click();

    await expect(page.getByText('Invalid username or password').first()).toBeVisible();
  });

  test('MFA-required response shows MFA form', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ mfaToken: 'test-mfa-token', message: 'MFA required' }),
      }),
    );

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await expect(page.locator('#mfaCode')).toBeVisible({ timeout: 3000 });
  });

  test('Sign In button is disabled while request is in flight', async ({ page }) => {
    await page.route('**/auth/user/login', async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    });
    await mockAuthRoutes(page);

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-submit')).toBeDisabled();
    await expect(page.getByText('Signing in...')).toBeVisible();
  });
});

test.describe('Auth - Register page', () => {
  test('renders register form when toggled from login', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/login');
    await page.getByTestId('switch-to-register').click();
    await expect(page.getByTestId('username-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
    await expect(page.getByTestId('confirm-password-input')).toBeVisible();
    await expect(page.getByTestId('register-submit')).toBeVisible();
  });

  test('can toggle back to login from register', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');
    await page.getByTestId('switch-to-login').click();
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('passwords not matching shows error toast', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('newuser');
    await page.getByTestId('password-input').fill('Password1!');
    await page.getByTestId('confirm-password-input').fill('Different1!');
    await page.getByTestId('register-submit').click();

    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  test('password shorter than 8 chars is rejected by browser validation', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('newuser');
    await page.getByTestId('password-input').fill('short');
    await page.getByTestId('confirm-password-input').fill('short');
    await page.getByTestId('register-submit').click();

    await expect(page.getByTestId('register-submit')).toBeVisible();
    await expect(page).toHaveURL(/#\/register$/);
  });

  test('successful registration shows MFA setup dialog', async ({ page }) => {
    await page.route('**/auth/user/register', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      }),
    );
    await mockAuthRoutes(page);

    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('newuser');
    await page.getByTestId('password-input').fill('ValidPass1!');
    await page.getByTestId('confirm-password-input').fill('ValidPass1!');
    await page.getByTestId('register-submit').click();

    await expect(page.getByText('Account created successfully!')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
  });

  test('server error during registration shows error toast', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/register', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ cause: 'Username already taken' }),
      }),
    );

    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('existing');
    await page.getByTestId('password-input').fill('ValidPass1!');
    await page.getByTestId('confirm-password-input').fill('ValidPass1!');
    await page.getByTestId('register-submit').click();

    await expect(page.getByText('Username already taken')).toBeVisible();
  });
});