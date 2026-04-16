import { test, expect } from '@playwright/test';
import {
  MOCK_ENCRYPTED_MESSAGE,
  bootstrapSignedInWithKeys,
  mockHubRoutes,
} from './fixtures/index';

async function setupHubView(
  page: Parameters<typeof bootstrapSignedInWithKeys>[0],
  options: Parameters<typeof mockHubRoutes>[2] = {},
) {
  await mockHubRoutes(page, undefined, options);
  await bootstrapSignedInWithKeys(page);
}

test.describe('Hub view', () => {
  test.describe.configure({ mode: 'serial' });

  test('renders a hub and lets the user navigate into a text channel', async ({ page }) => {
    await setupHubView(page);
    await page.goto('/#/hubs/hub-1');

    await expect(page.getByText('Test Hub One')).toBeVisible();
    await expect(page.getByText('Select a channel to start chatting')).toBeVisible();

    await page.getByRole('button', { name: /general/i }).click();
    await expect(page).toHaveURL(/#\/hubs\/hub-1\/channels\/channel-1$/, { timeout: 5000 });
    await expect(page.getByText('No messages yet. Start the conversation!')).toBeVisible();
  });

  test('message composer respects valid and invalid input states', async ({ page }) => {
    await setupHubView(page);
    await page.goto('/#/hubs/hub-1/channels/channel-1');

    const input = page.getByTestId('channel-message-input');
    const send = page.getByTestId('channel-message-send');

    await expect(send).toBeDisabled();

    await input.fill('x'.repeat(501));
    await expect(send).toBeDisabled();

    await input.fill('Hello channel');
    await expect(send).toBeEnabled();
  });

  test('sending a message refreshes the rendered message list', async ({ page }) => {
    await setupHubView(page);
    await page.goto('/#/hubs/hub-1/channels/channel-1');

    await page.getByTestId('channel-message-input').fill('Hello secure world');
    await page.getByTestId('channel-message-send').click();

    await expect(page.getByText('Hello secure world')).toBeVisible({ timeout: 5000 });
  });

  test('load older messages path fetches older entries', async ({ page }) => {
    await setupHubView(page, {
      messagesByChannel: {
        'channel-1': [MOCK_ENCRYPTED_MESSAGE],
      },
      olderMessagesByChannel: {
        'channel-1': [
          {
            ...MOCK_ENCRYPTED_MESSAGE,
            id: 'message-older',
            timestamp: '2024-01-01T08:00:00.000Z',
          },
        ],
      },
    });
    await page.goto('/#/hubs/hub-1/channels/channel-1');

    await expect(page.getByRole('button', { name: 'Load older messages' })).toBeVisible();
    await expect(page.getByText(/member-2/i)).toHaveCount(1);

    await page.getByRole('button', { name: 'Load older messages' }).click();
    await expect(page.getByText(/member-2/i)).toHaveCount(2);
  });

  test('owners can create a new text channel from the sidebar', async ({ page }) => {
    await setupHubView(page);
    await page.goto('/#/hubs/hub-1');

    await page.getByTestId('create-channel-input').fill('updates');
    await page.getByTestId('create-channel-submit').click();

    await expect(page.getByRole('button', { name: /updates/i })).toBeVisible({ timeout: 5000 });
  });
});
