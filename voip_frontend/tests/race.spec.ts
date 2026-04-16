import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  MOCK_ENCRYPTED_MESSAGE,
  MOCK_HUBS,
  bootstrapSignedInWithKeys,
  connectAppSocket,
  emitSocketEvent,
  mockHubRoutes,
  mockMusicRoutes,
  addRemoteAudioPeer,
  removeRemoteAudioPeer,
} from './fixtures/index';

async function createParticipant(
  browser: Browser,
  {
    user,
    hubOptions,
    route = '/#/hubs/hub-1',
  }: {
    user?: { id: string; sub: string; username: string; accessToken: string; refreshToken: string; mfaEnabled: boolean };
    hubOptions?: Parameters<typeof mockHubRoutes>[2];
    route?: string;
  } = {},
): Promise<{ context: BrowserContext; page: Page; controller: Awaited<ReturnType<typeof mockHubRoutes>> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const controller = await mockHubRoutes(page, MOCK_HUBS, hubOptions);
  await mockMusicRoutes(page);
  await bootstrapSignedInWithKeys(page, user);
  await connectAppSocket(page, `${user?.sub ?? 'test-user-id'}-peer`);
  await page.goto(route);
  return { context, page, controller };
}

test.describe('Race conditions', () => {
  test('voice state converges when one participant disconnects while peer updates are in flight', async ({ browser }) => {
    const a = await createParticipant(browser);
    const b = await createParticipant(browser);

    await a.page.getByRole('button', { name: /voice-lobby/i }).click();
    await b.page.getByRole('button', { name: /voice-lobby/i }).click();

    await emitSocketEvent(a.page, 'user-connected', { peerId: 'peer-b', alias: 'peer-b' });
    await emitSocketEvent(b.page, 'user-connected', { peerId: 'peer-a', alias: 'peer-a' });
    await addRemoteAudioPeer(a.page, 'peer-b', 'peer-b');
    await addRemoteAudioPeer(b.page, 'peer-a', 'peer-a');

    await expect(a.page.getByTestId('voice-peer-volume-peer-b')).toBeVisible();
    await expect(b.page.getByTestId('voice-peer-volume-peer-a')).toBeVisible();

    await a.page.getByTestId('voice-disconnect').click();
    await emitSocketEvent(b.page, 'user-disconnected', 'peer-a');
    await removeRemoteAudioPeer(b.page, 'peer-a');

    await expect(a.page.getByTestId('voice-panel')).toHaveCount(0);
    await expect(b.page.getByTestId('voice-peer-volume-peer-a')).toHaveCount(0);

    await a.context.close();
    await b.context.close();
  });

  test('ephemeral chat converges after start, join, and end across two contexts', async ({ browser }) => {
    const owner = await createParticipant(browser);
    const member = await createParticipant(browser, {
      user: {
        id: 'member-2',
        sub: 'member-2',
        username: 'teammate',
        accessToken: 'member-token',
        refreshToken: 'member-refresh',
        mfaEnabled: false,
      },
    });

    await owner.page.getByRole('button', { name: 'Start ephemeral chat' }).click();
    owner.controller.setEphemeral('hub-1', { active: true, roomId: 'ephemeral-hub-1', expiresAt: Math.floor(Date.now() / 1000) + 300 });
    member.controller.setEphemeral('hub-1', { active: true, roomId: 'ephemeral-hub-1', expiresAt: Math.floor(Date.now() / 1000) + 300 });

    await owner.page.goto('/#/hubs/hub-1');
    await member.page.goto('/#/hubs/hub-1');
    await connectAppSocket(owner.page, 'owner-peer-reloaded');
    await connectAppSocket(member.page, 'member-peer-reloaded');
    await owner.page.waitForTimeout(750);
    await member.page.waitForTimeout(750);

    await member.page.getByRole('button', { name: 'Join chat' }).click();
    await member.page.waitForTimeout(750);
    await member.page.getByRole('button', { name: 'Open chat' }).click();
    await member.page.getByTestId('ephemeral-chat-input').fill('race hello');
    await member.page.getByTestId('ephemeral-chat-send').click();
    await expect(member.page.getByText('race hello')).toBeVisible();

    await owner.page.getByRole('button', { name: 'Join chat' }).click();
    await owner.page.getByRole('button', { name: 'End ephemeral chat' }).click();
    owner.controller.setEphemeral('hub-1', { active: false, roomId: null, expiresAt: null });
    member.controller.setEphemeral('hub-1', { active: false, roomId: null, expiresAt: null });

    await owner.page.goto('/#/hubs/hub-1');
    await member.page.goto('/#/hubs/hub-1');
    await connectAppSocket(owner.page, 'owner-peer-final');
    await connectAppSocket(member.page, 'member-peer-final');

    await expect(owner.page.getByRole('button', { name: 'Start ephemeral chat' })).toBeVisible();
    await expect(member.page.getByRole('button', { name: 'Start ephemeral chat' })).toBeVisible();

    await owner.context.close();
    await member.context.close();
  });

  test('member drawer converges after an owner kicks a member', async ({ browser }) => {
    const owner = await createParticipant(browser, {
      hubOptions: {
        membersByHub: {
          'hub-1': [
            { id: 'member-owner', userId: 'test-user-id', hubId: 'hub-1', username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: '2024-01-01T00:00:00.000Z' },
            { id: 'member-guest', userId: 'member-2', hubId: 'hub-1', username: 'teammate', alias: 'teammate', role: 'member', joinedAt: '2024-01-01T00:05:00.000Z' },
          ],
        },
      },
    });
    const member = await createParticipant(browser, {
      user: {
        id: 'member-2',
        sub: 'member-2',
        username: 'teammate',
        accessToken: 'member-token',
        refreshToken: 'member-refresh',
        mfaEnabled: false,
      },
      hubOptions: {
        membersByHub: {
          'hub-1': [
            { id: 'member-owner', userId: 'test-user-id', hubId: 'hub-1', username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: '2024-01-01T00:00:00.000Z' },
            { id: 'member-guest', userId: 'member-2', hubId: 'hub-1', username: 'teammate', alias: 'teammate', role: 'member', joinedAt: '2024-01-01T00:05:00.000Z' },
          ],
        },
      },
    });

    await owner.page.getByRole('button', { name: /2 members/i }).click();
    await member.page.getByRole('button', { name: /2 members/i }).click();

    await owner.page.getByTestId('member-actions-member-guest').click();
    await owner.page.getByTestId('member-kick-member-guest').click();

    member.controller.removeMember('hub-1', 'member-guest');

    await owner.page.keyboard.press('Escape');
    await owner.page.getByRole('button').filter({ hasText: /members/i }).first().click();
    await expect(owner.page.getByText('teammate')).toHaveCount(0);

    await emitSocketEvent(member.page, 'member-joined', { hubId: 'hub-1' });
    await expect(member.page.getByRole('dialog').getByText('teammate')).toHaveCount(0);

    await owner.context.close();
    await member.context.close();
  });

  test('message refresh converges after disconnect and reconnect in two contexts', async ({ browser }) => {
    const a = await createParticipant(browser, { route: '/#/hubs/hub-1/channels/channel-1' });
    const b = await createParticipant(browser, { route: '/#/hubs/hub-1/channels/channel-1' });

    await emitSocketEvent(a.page, 'disconnect', 'transport close');
    a.controller.addMessage('channel-1', {
      ...MOCK_ENCRYPTED_MESSAGE,
      id: 'race-message-a',
      timestamp: '2024-01-01T09:30:00.000Z',
    });
    b.controller.addMessage('channel-1', {
      ...MOCK_ENCRYPTED_MESSAGE,
      id: 'race-message-b',
      timestamp: '2024-01-01T09:30:00.000Z',
    });

    await connectAppSocket(a.page, 'peer-reconnect-a');
    await emitSocketEvent(a.page, 'channel-message-sent', { hubId: 'hub-1', channelId: 'channel-1' });
    await emitSocketEvent(b.page, 'channel-message-sent', { hubId: 'hub-1', channelId: 'channel-1' });

    await expect(a.page.getByText(/member-2/i)).toBeVisible();
    await expect(b.page.getByText(/member-2/i)).toBeVisible();

    await a.context.close();
    await b.context.close();
  });
});
