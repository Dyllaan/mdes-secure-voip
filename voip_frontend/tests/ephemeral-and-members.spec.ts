import { expect, test } from '@playwright/test';
import {
  MOCK_HUBS,
  MOCK_USER,
  bootstrapSignedInWithKeys,
  connectAppSocket,
  mockHubRoutes,
} from './fixtures/index';

async function setupHub(
  page: Parameters<typeof bootstrapSignedInWithKeys>[0],
  options: {
    hubOptions?: Parameters<typeof mockHubRoutes>[2];
    hubs?: typeof MOCK_HUBS;
    user?: typeof MOCK_USER;
  } = {},
) {
  await mockHubRoutes(page, options.hubs ?? MOCK_HUBS, options.hubOptions);
  await bootstrapSignedInWithKeys(page, options.user ?? MOCK_USER);
  await connectAppSocket(page);
  await page.goto('/#/hubs/hub-1');
  await expect(page.getByRole('button', { name: /ephemeral chat|join chat/i })).toBeEnabled();
  await page.waitForTimeout(750);
}

test.describe('Ephemeral chat and member management', () => {
  test('user can start, join, open, send in, leave, and end ephemeral chat', async ({ page }) => {
    await setupHub(page);

    await page.getByRole('button', { name: 'Start ephemeral chat' }).click();
    await expect(page.getByRole('button', { name: 'Join chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Join chat' }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole('button', { name: 'Open chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Open chat' }).click();
    await expect(page.getByTestId('ephemeral-chat-input')).toBeVisible();
    await page.getByTestId('ephemeral-chat-input').fill('Secret hello');
    await page.getByTestId('ephemeral-chat-send').click();

    await expect(page.getByText('Secret hello')).toBeVisible();

    await page.getByTestId('ephemeral-chat-leave').click();
    await expect(page.getByTestId('ephemeral-chat-panel')).toHaveCount(0);

    await page.getByRole('button', { name: 'Join chat' }).click();
    await page.getByRole('button', { name: 'End ephemeral chat' }).click();

    await expect(page.getByRole('button', { name: 'Start ephemeral chat' })).toBeVisible();
  });

  test('user can join an already active ephemeral session', async ({ page }) => {
    await setupHub(page, {
      hubOptions: {
        ephemeralByHub: {
          'hub-1': {
            active: true,
            roomId: 'ephemeral-hub-1',
            expiresAt: Math.floor(Date.now() / 1000) + 300,
          },
        },
      },
    });

    await expect(page.getByRole('button', { name: 'Join chat' })).toBeVisible();
    await page.getByRole('button', { name: 'Join chat' }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Open chat' }).click();

    await expect(page.getByTestId('ephemeral-chat-input')).toBeVisible();
  });

  test('owner can create an invite and kick a member', async ({ page }) => {
    await setupHub(page);

    await page.getByRole('button', { name: /2 members/i }).click();
    await page.getByTestId('members-generate-invite').click();
    await expect(page.getByText('INVITE-HUB-1')).toBeVisible();

    await page.getByTestId('member-actions-member-2').click();
    await page.getByTestId('member-kick-member-2').click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /members/i }).click();
    await expect(page.getByText('teammate')).toHaveCount(0);
  });

  test('non-owners do not get moderation controls', async ({ page }) => {
    await setupHub(page, {
      user: {
        id: 'member-self',
        sub: 'member-self',
        username: 'member-self',
        accessToken: 'member-access-token',
        refreshToken: 'member-refresh-token',
        mfaEnabled: false,
      },
      hubs: [
        { ...MOCK_HUBS[0], ownerId: 'owner-1' },
        ...MOCK_HUBS.slice(1),
      ],
      hubOptions: {
        membersByHub: {
          'hub-1': [
            { id: 'member-owner', userId: 'owner-1', hubId: 'hub-1', username: 'owner', alias: 'owner', role: 'owner', joinedAt: '2024-01-01T00:00:00.000Z' },
            { id: 'member-self', userId: 'member-self', hubId: 'hub-1', username: 'member-self', alias: 'member-self', role: 'member', joinedAt: '2024-01-01T00:05:00.000Z' },
          ],
        },
      },
    });

    await page.getByRole('button', { name: /2 members/i }).click();
    await expect(page.getByText('owner').first()).toBeVisible();
    await expect(page.getByTestId('member-actions-member-owner')).toHaveCount(0);
    await expect(page.getByTestId('member-actions-member-self')).toHaveCount(0);
  });
});
