import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  MOCK_ENCRYPTED_MESSAGE,
  MOCK_HUBS,
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
  const musicController = await mockMusicRoutes(page);
  await bootstrapSignedInWithKeys(page);
  await connectAppSocket(page);
  await page.goto('/#/hubs/hub-1');
  await page.getByRole('button', { name: /voice-lobby/i }).click();
  return { hubController, musicController };
}

async function createMusicParticipant(
  browser: Browser,
  sharedMusicState: {
    activeRooms: Set<string>;
    statusByRoom: Record<string, {
      roomId?: string;
      queue?: Array<{ id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' }>;
      currentIndex?: number;
      currentTrack?: { id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' } | null;
      playing: boolean;
      paused: boolean;
      positionMs: number;
      url: string | null;
      videoMode?: boolean;
      screenPeerId?: string | null;
    } | null>;
  },
  {
    user,
    peerId,
  }: {
    user?: { id: string; sub: string; username: string; accessToken: string; refreshToken: string; mfaEnabled: boolean };
    peerId: string;
  },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockHubRoutes(page, MOCK_HUBS, {
    membersByHub: {
      'hub-1': [
        { id: 'member-1', userId: 'test-user-id', hubId: 'hub-1', username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'member-2', userId: 'member-2', hubId: 'hub-1', username: 'teammate', alias: 'teammate', role: 'member', joinedAt: '2024-01-01T00:05:00.000Z' },
      ],
    },
  });
  await mockMusicRoutes(page, {
    sharedState: sharedMusicState,
    resolveItems: [
      {
        id: 'yt-track-1',
        url: 'https://www.youtube.com/watch?v=yt-track-1',
        title: 'Shared Track',
        channel: 'Shared Channel',
        duration: '3:15',
        durationMs: 195000,
      },
    ],
  });
  await bootstrapSignedInWithKeys(page, user);
  await connectAppSocket(page, peerId);
  await page.goto('/#/hubs/hub-1');
  await page.getByRole('button', { name: /voice-lobby/i }).click();
  await page.getByRole('button', { name: 'Music queue' }).click();
  return { context, page };
}

async function startSeekInteraction(page: Page, seconds: number) {
  await page.getByTestId('music-seek').evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setValue?.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
}

async function updateSeekInteraction(page: Page, seconds: number) {
  await page.getByTestId('music-seek').evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
}

async function finishSeekInteraction(page: Page) {
  await page.getByTestId('music-seek').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
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
    await expect(page.getByText(/Test Track|Loading/i).first()).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('mdes:queue:')),
    )).toEqual([]);
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

  test('music seek commits once on release and clamps to the current track duration', async ({ page }) => {
    const { musicController } = await setupMusicHub(page);

    await page.getByRole('button', { name: 'Music queue' }).click();
    await page.getByTestId('music-add-bot').click();
    await page.getByTestId('music-url-input').fill('https://www.youtube.com/watch?v=yt-track-1');
    await page.getByTestId('music-add-track').click();

    const seek = page.getByTestId('music-seek');
    await expect(seek).toBeEnabled();
    await expect(seek).toHaveAttribute('max', '195');

    await startSeekInteraction(page, 20);
    await expect(page.getByText('0:20').first()).toBeVisible();
    await expect.poll(() => musicController.seekRequests.length).toBe(0);

    await updateSeekInteraction(page, 999);
    await expect(page.getByText('3:15').first()).toBeVisible();
    await expect.poll(() => musicController.seekRequests.length).toBe(0);

    await finishSeekInteraction(page);

    await expect.poll(() => musicController.seekRequests.length).toBe(1);
    expect(musicController.seekRequests[0]).toEqual({
      roomId: 'channel-2',
      requestedSeconds: 195,
      appliedSeconds: 195,
    });
    await expect(seek).toHaveValue('195');
  });

  test('music seek is disabled when the current track duration is unknown', async ({ page }) => {
    await mockHubRoutes(page);
    const musicController = await mockMusicRoutes(page, {
      resolveItems: [
        {
          id: 'sc-track-1',
          url: 'https://soundcloud.com/test/unknown-duration',
          title: 'Unknown Length Track',
          channel: 'Test Channel',
          duration: '--:--',
          durationMs: 0,
        },
      ],
    });
    await bootstrapSignedInWithKeys(page);
    await connectAppSocket(page);
    await page.goto('/#/hubs/hub-1');
    await page.getByRole('button', { name: /voice-lobby/i }).click();
    await page.getByRole('button', { name: 'Music queue' }).click();
    await page.getByTestId('music-add-bot').click();
    await page.getByTestId('music-url-input').fill('https://soundcloud.com/test/unknown-duration');
    await page.getByTestId('music-add-track').click();

    const seek = page.getByTestId('music-seek');
    await expect(seek).toBeDisabled();
    await expect(seek).toHaveAttribute('max', '0');
    expect(musicController.seekRequests).toEqual([]);
  });

  test('music queue state converges across two browser contexts', async ({ browser }) => {
    const sharedMusicState = {
      activeRooms: new Set<string>(),
      statusByRoom: {} as Record<string, {
        roomId?: string;
        queue?: Array<{ id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' }>;
        currentIndex?: number;
        currentTrack?: { id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' } | null;
        playing: boolean;
        paused: boolean;
        positionMs: number;
        url: string | null;
        videoMode?: boolean;
        screenPeerId?: string | null;
      } | null>,
    };

    const owner = await createMusicParticipant(browser, sharedMusicState, { peerId: 'owner-peer' });
    const member = await createMusicParticipant(browser, sharedMusicState, {
      peerId: 'member-peer',
      user: {
        id: 'member-2',
        sub: 'member-2',
        username: 'teammate',
        accessToken: 'member-token',
        refreshToken: 'member-refresh',
        mfaEnabled: false,
      },
    });

    await owner.page.getByTestId('music-add-bot').click();
    await owner.page.getByTestId('music-url-input').fill('https://www.youtube.com/watch?v=yt-track-1');
    await owner.page.getByTestId('music-add-track').click();
    await expect(owner.page.getByText('Shared Track').first()).toBeVisible();

    await expect.poll(() => Object.keys(sharedMusicState.statusByRoom)).toEqual(['channel-2']);
    const roomId = 'channel-2';
    const activeSession = sharedMusicState.statusByRoom[roomId];
    await emitSocketEvent(owner.page, 'musicman:session-state', { roomId, active: true, state: activeSession });
    await emitSocketEvent(member.page, 'musicman:session-state', { roomId, active: true, state: activeSession });

    await expect(member.page.getByText('Shared Track').first()).toBeVisible();
    await expect(member.page.getByTestId('music-stop')).toBeVisible();

    await member.page.getByTestId('music-stop').click();
    await expect.poll(() => sharedMusicState.statusByRoom[roomId]).toBeNull();
    await emitSocketEvent(owner.page, 'musicman:session-state', { roomId, active: false, state: null });
    await emitSocketEvent(member.page, 'musicman:session-state', { roomId, active: false, state: null });

    await expect(owner.page.getByTestId('music-stop')).toHaveCount(0);
    await expect(owner.page.getByText('Shared Track')).toHaveCount(0);
    await expect(member.page.getByTestId('music-stop')).toHaveCount(0);

    await owner.context.close();
    await member.context.close();
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
