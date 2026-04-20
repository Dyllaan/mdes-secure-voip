import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_LIMIT_RESPONSE,
  MOCK_HUBS,
  MOCK_USER,
  bootstrapSignedInWithKeys,
  connectAppSocket,
  emitSocketAuthFailure,
  emitSocketSessionExpired,
  mockAuthRoutes,
  setAuthState,
} from './fixtures/index';

const VERIFIED_MFA_USER = {
  ...MOCK_USER,
  accessToken: 'header.eyJzdWIiOiJ0ZXN0LXVzZXItaWQifQ==.signature',
};

async function mockHubListResponses(page: Page, statuses: number[]) {
  let requestCount = 0;
  await page.route('**/hub/hubs', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
      return;
    }

    const status = statuses[Math.min(requestCount, statuses.length - 1)] ?? 200;
    requestCount += 1;
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? MOCK_HUBS : { cause: 'Unauthorized' }),
    });
  });

  return {
    getRequestCount: () => requestCount,
  };
}

test.describe('Auth - Login page', () => {
  test('renders username, password inputs and Sign In button', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.getByTestId('username-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('visiting login without stored session does not call logout during bootstrap', async ({ page }) => {
    let logoutRequests = 0;

    await mockAuthRoutes(page);
    await page.route('**/auth/user/logout', async (route) => {
      logoutRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Logged out successfully' }),
      });
    });

    await page.goto('/#/login');

    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect.poll(() => logoutRequests).toBe(0);
  });

  test('anonymous login page reload does not emit a logout beacon', async ({ page }) => {
    let logoutRequests = 0;

    await mockAuthRoutes(page);
    await page.route('**/auth/user/logout', async (route) => {
      logoutRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Logged out successfully' }),
      });
    });

    await page.goto('/#/login');
    await page.reload();

    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect.poll(() => logoutRequests).toBe(0);
  });

  test('toggle to register mode shows register form', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/login');
    await page.getByTestId('switch-to-register').click();
    await expect(page.getByTestId('register-submit')).toBeVisible();
    await expect(page.getByTestId('confirm-password-input')).toBeVisible();
  });

  test('successful login redirects into key setup when encryption keys are missing', async ({ page }) => {
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

    await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });
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
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeEnabled();
    await expect(page.getByTestId('login-submit')).toHaveText('Sign In');
    await expect(page.getByTestId('username-input')).toBeEnabled();
    await expect(page.getByTestId('password-input')).toBeEnabled();
  });

  test('demo-expired login shows the demo ended dialog', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          demoToken: 'demo-delete-token',
          message: 'Your demo session has expired. Use the demo token to delete your account.',
        }),
      }),
    );

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Demo Ended')).toBeVisible();
    await expect(page.getByText('Your demo session has expired. Use the demo token to delete your account.')).toBeVisible();
    await expect(page.getByTestId('demo-delete-submit')).toBeVisible();
  });

  test('demo-limited login dialog deletes the demo account with the demo token', async ({ page }) => {
    let deleteAuthorization = '';

    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          demoToken: 'demo-delete-token',
          message: 'Your demo session has expired. Use the demo token to delete your account.',
        }),
      }),
    );
    await page.route('**/auth/user/delete', async (route) => {
      deleteAuthorization = route.request().headers()['authorization'] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'User deleted successfully' }),
      });
    });

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await page.getByTestId('demo-delete-submit').click();

    await expect.poll(() => deleteAuthorization).toBe('Bearer demo-delete-token');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('demo-limited login dialog keeps the modal open when delete fails', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          demoToken: 'demo-delete-token',
          message: 'Your demo session has expired. Use the demo token to delete your account.',
        }),
      }),
    );
    await page.route('**/auth/user/delete', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ cause: 'Invalid token' }),
      });
    });

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('demo-delete-submit').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('demo-delete-error')).toHaveText('Invalid token');
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

    await expect(page.locator('#verifyCode')).toBeVisible({ timeout: 3000 });
  });

  test('MFA verification success redirects to key setup when device keys are missing', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ mfaToken: 'test-mfa-token', message: 'MFA required' }),
      }),
    );
    await page.route('**/auth/user/verify-mfa', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(VERIFIED_MFA_USER),
      }),
    );

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await page.locator('#verifyCode').fill('123456');
    await page.getByRole('button', { name: 'Verify Code' }).click();

    await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });
  });

  test('invalid MFA code keeps the user on the MFA form and shows feedback', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ mfaToken: 'test-mfa-token', message: 'MFA required' }),
      }),
    );
    await page.route('**/auth/user/verify-mfa', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ cause: 'Invalid authentication code' }),
      }),
    );

    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    await page.locator('#verifyCode').fill('123456');
    await page.getByRole('button', { name: 'Verify Code' }).click();

    await expect(page.locator('#verifyCode')).toBeVisible();
    await expect(page.getByText('Invalid authentication code').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify Code' })).toHaveText('Verify Code');
    await expect(page.locator('#verifyCode')).toBeEnabled();
    await page.locator('#verifyCode').fill('654321');
    await expect(page.getByRole('button', { name: 'Verify Code' })).toBeEnabled();
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

  test('demo-expired refresh on app load shows the demo ended dialog', async ({ page }) => {
    await setAuthState(page, MOCK_USER);
    await mockAuthRoutes(page, MOCK_USER, {
      meStatus: 401,
      refreshStatus: 403,
      refreshBody: {
        demoToken: 'refresh-demo-token',
        message: 'Your demo session has expired. Use the demo token to delete your account.',
      },
      includeTurnCredentials: false,
    });

    await page.goto('/#/login');

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Demo Ended')).toBeVisible();
    await expect(page.getByText('Your demo session has expired. Use the demo token to delete your account.')).toBeVisible();
  });

  test('demo-limited refresh dialog deletes the demo account with the demo token', async ({ page }) => {
    let deleteAuthorization = '';

    await setAuthState(page, MOCK_USER);
    await mockAuthRoutes(page, MOCK_USER, {
      meStatus: 401,
      refreshStatus: 403,
      refreshBody: {
        demoToken: 'refresh-demo-token',
        message: 'Your demo session has expired. Use the demo token to delete your account.',
      },
      includeTurnCredentials: false,
    });
    await page.route('**/auth/user/delete', async (route) => {
      deleteAuthorization = route.request().headers()['authorization'] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'User deleted successfully' }),
      });
    });

    await page.goto('/#/login');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByTestId('demo-delete-submit').click();

    await expect.poll(() => deleteAuthorization).toBe('Bearer refresh-demo-token');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('invalid refresh on app load logs the user out without showing the demo dialog', async ({ page }) => {
    let logoutRequests = 0;

    await setAuthState(page, MOCK_USER);
    await mockAuthRoutes(page, MOCK_USER, {
      meStatus: 401,
      refreshStatus: 401,
      refreshBody: { cause: 'Refresh failed' },
      includeTurnCredentials: false,
    });
    await page.route('**/auth/user/logout', async (route) => {
      logoutRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Logged out successfully' }),
      });
    });

    await page.goto('/#/login');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect.poll(() => logoutRequests).toBe(0);
  });

  test('protected hub request retries after refresh success', async ({ page }) => {
    let refreshRequests = 0;

    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/profile');
    await page.route('**/auth/user/refresh', async (route) => {
      refreshRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    });
    const hubRoute = await mockHubListResponses(page, [401, 200]);

    await page.goto('/#/hub-list');

    await expect(page.getByRole('button', { name: /Test Hub One/i })).toBeVisible();
    await expect.poll(() => refreshRequests).toBe(1);
    await expect.poll(() => hubRoute.getRequestCount() >= 2).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('protected hub request logs out on refresh 401 without showing the demo dialog', async ({ page }) => {
    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/profile');
    await page.route('**/auth/user/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ cause: 'Refresh failed' }),
      });
    });
    await mockHubListResponses(page, [401]);

    await page.goto('/#/hub-list');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/login$/, { timeout: 5000 });
  });

  test('protected hub request shows the demo dialog when refresh is demo-limited', async ({ page }) => {
    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await page.goto('/#/profile');
    await page.route('**/auth/user/refresh', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify(DEMO_LIMIT_RESPONSE),
      });
    });
    await mockHubListResponses(page, [401]);

    await page.goto('/#/hub-list');

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(DEMO_LIMIT_RESPONSE.message)).toBeVisible();
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  for (const socketAuthMessage of ['Invalid or expired token', 'Authentication required'] as const) {
    test(`realtime ${socketAuthMessage} recovers when refresh succeeds`, async ({ page }) => {
      let refreshRequests = 0;

      await mockHubListResponses(page, [200]);
      await bootstrapSignedInWithKeys(page);
      await page.route('**/auth/user/refresh', async (route) => {
        refreshRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_USER),
        });
      });

      await page.goto('/#/hub-list');
      await connectAppSocket(page);
      await emitSocketAuthFailure(page, socketAuthMessage);

      await expect.poll(() => refreshRequests).toBe(1);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Profile/i })).toBeVisible();
    });

    test(`realtime ${socketAuthMessage} logs out on refresh 401`, async ({ page }) => {
      await mockHubListResponses(page, [200]);
      await bootstrapSignedInWithKeys(page);
      await page.route('**/auth/user/refresh', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ cause: 'Refresh failed' }),
        });
      });
      await mockHubListResponses(page, [200]);

      await page.goto('/#/hub-list');
      await connectAppSocket(page);
      await emitSocketAuthFailure(page, socketAuthMessage);

      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByTestId('login-form')).toBeVisible();
    });

    test(`realtime ${socketAuthMessage} shows the demo dialog on refresh 403`, async ({ page }) => {
      await mockHubListResponses(page, [200]);
      await bootstrapSignedInWithKeys(page);
      await page.route('**/auth/user/refresh', async (route) => {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify(DEMO_LIMIT_RESPONSE),
        });
      });
      await mockHubListResponses(page, [200]);

      await page.goto('/#/hub-list');
      await connectAppSocket(page);
      await emitSocketAuthFailure(page, socketAuthMessage);

      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText(DEMO_LIMIT_RESPONSE.message)).toBeVisible();
      await expect(page.getByTestId('login-form')).toBeVisible();
    });
  }

  test('realtime session-expired recovers when refresh succeeds', async ({ page }) => {
    let refreshRequests = 0;

    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await page.route('**/auth/user/refresh', async (route) => {
      refreshRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    });

    await page.goto('/#/hub-list');
    await connectAppSocket(page);
    await emitSocketSessionExpired(page);

    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Profile/i })).toBeVisible();
  });

  test('realtime session-expired logs out on refresh 401', async ({ page }) => {
    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await page.route('**/auth/user/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ cause: 'Refresh failed' }),
      });
    });
    await mockHubListResponses(page, [200]);

    await page.goto('/#/hub-list');
    await connectAppSocket(page);
    await emitSocketSessionExpired(page);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('realtime session-expired shows the demo dialog on refresh 403', async ({ page }) => {
    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await page.route('**/auth/user/refresh', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify(DEMO_LIMIT_RESPONSE),
      });
    });
    await mockHubListResponses(page, [200]);

    await page.goto('/#/hub-list');
    await connectAppSocket(page);
    await emitSocketSessionExpired(page);

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(DEMO_LIMIT_RESPONSE.message)).toBeVisible();
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('ordinary realtime disconnect does not log the user out or show the demo dialog', async ({ page }) => {
    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await mockHubListResponses(page, [200]);

    await page.goto('/#/hub-list');
    await connectAppSocket(page);
    await page.evaluate(() => {
      const harness = window.__APP_E2E__;
      harness?.emitSocketEvent('disconnect', 'transport close');
    });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Profile/i })).toBeVisible();
  });

  test('generic realtime socket errors do not log the user out or show the demo dialog', async ({ page }) => {
    await mockHubListResponses(page, [200]);
    await bootstrapSignedInWithKeys(page);
    await mockHubListResponses(page, [200]);

    await page.goto('/#/hub-list');
    await connectAppSocket(page);
    await page.evaluate(() => {
      const harness = window.__APP_E2E__;
      harness?.emitSocketEvent('connect_error', { message: 'Temporary network error' });
    });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Profile/i })).toBeVisible();
  });
});

test.describe('Auth - Register page', () => {
  test('renders register form when navigated to /register', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');
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

  test('password mismatch keeps register submit disabled and shows validation', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('newuser');
    await page.getByTestId('password-input').fill('Password1');
    await page.getByTestId('confirm-password-input').fill('Different1');

    await expect(page.getByTestId('register-submit')).toBeDisabled();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  test('password shorter than 8 chars keeps register submit disabled', async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('newuser');
    await page.getByTestId('password-input').fill('short');
    await page.getByTestId('confirm-password-input').fill('short');

    await expect(page.getByTestId('register-submit')).toBeDisabled();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('successful registration logs the user in and sends them to key setup when keys are missing', async ({ page }) => {
    await page.route('**/auth/user/register', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      }),
    );
    await mockAuthRoutes(page);

    await page.goto('/#/register');
    await page.getByTestId('username-input').fill('newuser');
    await page.getByTestId('password-input').fill('ValidPass1');
    await page.getByTestId('confirm-password-input').fill('ValidPass1');
    await page.getByTestId('register-submit').click();

    await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });
  });

  test('trusted-device login does not persist the device token in localStorage', async ({ page }) => {
    await page.route('**/auth/user/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_USER }),
      }),
    );
    await mockAuthRoutes(page);
    await page.goto('/#/login');
    await page.getByTestId('username-input').fill('testuser');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });

    // device token must not appear anywhere in localStorage
    await expect.poll(async () =>
      page.evaluate(() => {
        const user = JSON.parse(localStorage.getItem('user') ?? '{}');
        return 'deviceToken' in user;
      })
    ).toBe(false);
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
    await page.getByTestId('password-input').fill('ValidPass1');
    await page.getByTestId('confirm-password-input').fill('ValidPass1');
    await page.getByTestId('register-submit').click();

    await expect(page.getByText('Username already taken').first()).toBeVisible();
  });
});
