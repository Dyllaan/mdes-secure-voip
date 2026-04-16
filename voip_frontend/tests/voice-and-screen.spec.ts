import { expect, test } from '@playwright/test';
import {
  addRemoteAudioPeer,
  addRemoteScreenshare,
  bootstrapSignedInWithKeys,
  connectAppSocket,
  emitSocketEvent,
  mockHubRoutes,
  removeRemoteAudioPeer,
  removeRemoteScreenshare,
} from './fixtures/index';

async function setupVoiceHub(page: Parameters<typeof bootstrapSignedInWithKeys>[0]) {
  await mockHubRoutes(page);
  await bootstrapSignedInWithKeys(page);
  await connectAppSocket(page);
  await page.goto('/#/hubs/hub-1');
}

test.describe('Voice and screenshare', () => {
  test('user can join voice, mute, and disconnect', async ({ page }) => {
    await setupVoiceHub(page);

    await page.getByRole('button', { name: /voice-lobby/i }).click();

    await expect(page.getByTestId('voice-panel')).toBeVisible();
    await expect(page.getByText('Voice Connected')).toBeVisible();

    await page.getByTestId('voice-mute-toggle').click();
    await expect(page.getByTestId('voice-mute-toggle')).toContainText('Unmute');

    await page.getByTestId('voice-disconnect').click();
    await expect(page.getByTestId('voice-panel')).toBeHidden();
  });

  test('remote peers can appear and disappear after joining voice', async ({ page }) => {
    await setupVoiceHub(page);
    await page.getByRole('button', { name: /voice-lobby/i }).click();

    await emitSocketEvent(page, 'user-connected', { peerId: 'peer-2', alias: 'teammate' });
    await addRemoteAudioPeer(page, 'peer-2', 'teammate');

    await expect(page.getByTestId('voice-panel').getByText('teammate')).toBeVisible();
    await expect(page.getByTestId('voice-peer-volume-peer-2')).toBeVisible();

    await removeRemoteAudioPeer(page, 'peer-2');
    await emitSocketEvent(page, 'user-disconnected', 'peer-2');

    await expect(page.getByTestId('voice-peer-volume-peer-2')).toHaveCount(0);
  });

  test('screenshare can start and stop from the actions sidebar', async ({ page }) => {
    await setupVoiceHub(page);
    await page.getByRole('button', { name: /voice-lobby/i }).click();

    await page.getByRole('button', { name: 'Screen sharing' }).click();
    await page.getByTestId('screenshare-toggle').click();

    await expect(page.getByTestId('screenshare-toggle')).toContainText('Stop sharing');

    await page.getByTestId('screenshare-toggle').click();
    await expect(page.getByTestId('screenshare-toggle')).toContainText('Share your screen');
  });

  test('remote screenshares can appear and disappear', async ({ page }) => {
    await setupVoiceHub(page);
    await page.getByRole('button', { name: /voice-lobby/i }).click();
    await page.getByRole('button', { name: 'Screen sharing' }).click();

    await addRemoteScreenshare(page, 'screen-peer-2', 'teammate');
    await expect(page.getByText('teammate')).toBeVisible();

    await removeRemoteScreenshare(page, 'screen-peer-2');
    await expect(page.getByText('teammate')).toHaveCount(0);
  });

  test('denied screenshare permissions leave sharing inactive', async ({ page }) => {
    await setupVoiceHub(page);
    await page.getByRole('button', { name: /voice-lobby/i }).click();

    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      };
    });

    await page.getByRole('button', { name: 'Screen sharing' }).click();
    await page.getByTestId('screenshare-toggle').click();

    await expect(page.getByTestId('screenshare-toggle')).toContainText('Share your screen');
  });
});
