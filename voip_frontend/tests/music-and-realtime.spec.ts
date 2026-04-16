import { expect, test } from '@playwright/test';
import {
  MOCK_ENCRYPTED_MESSAGE,
  bootstrapSignedInWithKeys,
  connectAppSocket,
  emitSocketEvent,
  mockHubRoutes,
  mockMusicRoutes,
} from './fixtures/index';

async function setupMusicHub(page: Parameters<typeof bootstrapSignedInWithKeys>[0]) {
  const hubController = await mockHubRoutes(page, undefined, {
    membersByHub: {
      'hub-1': [
        { id: 'member-1', userId: 'test-user-id', hubId: 'hub-1', username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: '2024-01-01T00:00:00.000Z' },
      ],
    },
  });
  await mockMusicRoutes(page);
  await bootstrapSignedInWithKeys(page);
  await connectAppSocket(page);
  await page.goto('/#/hubs/hub-1');
  await page.getByRole('button', { name: /voice-lobby/i }).click();
  return hubController;
}

test.describe('Music and realtime hub updates', () => {
  test('music panel supports add bot, add track, pause/resume, next, and stop', async ({ page }) => {
    await setupMusicHub(page);

    await page.getByRole('button', { name: 'Music queue' }).click();
    await page.getByTestId('music-add-bot').click();
    await expect(page.getByTestId('music-url-input')).toBeVisible();

    await page.getByTestId('music-url-input').fill('https://www.youtube.com/watch?v=yt-track-1');
    await page.getByTestId('music-add-track').click();

    await expect(page.getByTestId('music-pause-resume')).toBeVisible();
    await expect(page.getByText(/Test Track|Loading/i).first()).toBeVisible();

    await page.getByTestId('music-url-input').fill('https://www.youtube.com/watch?v=yt-track-2');
    await page.getByTestId('music-add-track').click();
    await expect(page.getByTestId('music-next')).toBeVisible();

    await expect(page.getByTestId('music-pause-resume')).toHaveAttribute('title', 'Pause');
    await page.getByTestId('music-pause-resume').click();
    await expect(page.getByTestId('music-pause-resume')).toHaveAttribute('title', 'Resume');
    await page.getByTestId('music-pause-resume').click();
    await expect(page.getByTestId('music-pause-resume')).toHaveAttribute('title', 'Pause');

    await page.getByTestId('music-next').click();
    await expect(page.getByTestId('music-stop')).toBeVisible();

    await page.getByTestId('music-stop').click();
    await expect(page.getByTestId('music-stop')).toHaveCount(0);
  });

  test('music panel supports video mode and queue clearing', async ({ page }) => {
    await setupMusicHub(page);

    await page.getByRole('button', { name: 'Music queue' }).click();
    await page.getByTestId('music-add-bot').click();
    await page.getByTestId('music-video-mode-toggle').click();
    await expect(page.getByText(/Video will stream as a screenshare/i)).toBeVisible();

    await page.getByTestId('music-url-input').fill('https://www.youtube.com/watch?v=yt-track-1');
    await page.getByTestId('music-add-track').click();
    await expect(page.getByText('Video')).toBeVisible();

    await page.getByTestId('music-clear-queue').click();
    await expect(page.getByText('Test Track')).toHaveCount(0);
    await expect(page.getByTestId('music-clear-queue')).toHaveCount(0);
  });

  test('channel message, channel list, and members refresh on realtime events', async ({ page }) => {
    const hubController = await mockHubRoutes(page, undefined, {
      messagesByChannel: {
        'channel-1': [],
      },
    });
    await mockMusicRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await connectAppSocket(page);
    await page.goto('/#/hubs/hub-1/channels/channel-1');

    hubController.addMessage('channel-1', {
      ...MOCK_ENCRYPTED_MESSAGE,
      id: 'message-live-1',
      timestamp: '2024-01-01T09:10:00.000Z',
    });
    await emitSocketEvent(page, 'channel-message-sent', { hubId: 'hub-1', channelId: 'channel-1' });
    await expect(page.getByText(/member-2/i)).toBeVisible();

    hubController.addChannel('hub-1', {
      id: 'channel-live-1',
      name: 'release-notes',
      type: 'text',
      hubId: 'hub-1',
      createdAt: '2024-01-01T10:00:00.000Z',
    });
    await emitSocketEvent(page, 'channel-created', { hubId: 'hub-1' });
    await expect(page.getByRole('button', { name: /release-notes/i })).toBeVisible();

    hubController.addMember('hub-1', {
      id: 'member-live-1',
      userId: 'member-live-1',
      hubId: 'hub-1',
      username: 'newfriend',
      alias: 'newfriend',
      role: 'member',
      joinedAt: '2024-01-01T10:05:00.000Z',
    });
    await emitSocketEvent(page, 'member-joined', { hubId: 'hub-1' });
    await page.getByRole('button', { name: /members/i }).click();
    await expect(page.getByText('newfriend')).toBeVisible();
  });

  test('hub recovers after reconnect and refetches current messages', async ({ page }) => {
    const hubController = await mockHubRoutes(page, undefined, {
      messagesByChannel: {
        'channel-1': [],
      },
    });
    await mockMusicRoutes(page);
    await bootstrapSignedInWithKeys(page);
    await connectAppSocket(page);
    await page.goto('/#/hubs/hub-1/channels/channel-1');

    await emitSocketEvent(page, 'disconnect', 'transport close');
    hubController.addMessage('channel-1', {
      ...MOCK_ENCRYPTED_MESSAGE,
      id: 'message-after-reconnect',
      timestamp: '2024-01-01T09:20:00.000Z',
    });
    await connectAppSocket(page, 'peer-self-reconnected');
    await emitSocketEvent(page, 'channel-message-sent', { hubId: 'hub-1', channelId: 'channel-1' });

    await expect(page.getByText(/member-2/i)).toBeVisible();
  });
});
