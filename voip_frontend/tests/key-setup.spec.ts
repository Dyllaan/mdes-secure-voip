import { test, expect, type Page } from '@playwright/test';
import { bootstrapSignedIn } from './fixtures/index';

const INVALID_24_WORD_PHRASE = Array(24).fill('hello').join(' ');
const VALID_24_WORD_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const EXPECTED_DEVICE_ID = '6da6416b-270c-6fdc-7a62-737eaaa84d25';
const EXPECTED_PRIVATE_JWK = {
  kty: 'EC',
  crv: 'P-256',
  d: 'u0BwvMHOKw5-Y9EmNKYT1L7z3ECmNIkRTDAIHacX74Q',
  x: 'm_PGMiPF3-eHcdiDC4phgYSC-HRwcqPm_2jRQ3bDtnY',
  y: '41zcQuKkZz-oTPdvvwvKEQDyNO85nlitgmS_IJVTKR4',
  ext: true,
} satisfies JsonWebKey;
const EXPECTED_PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'm_PGMiPF3-eHcdiDC4phgYSC-HRwcqPm_2jRQ3bDtnY',
  y: '41zcQuKkZz-oTPdvvwvKEQDyNO85nlitgmS_IJVTKR4',
  ext: true,
} satisfies JsonWebKey;
const EXPECTED_PUBLIC_KEY_SPKI = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEm/PGMiPF3+eHcdiDC4phgYSC+HRwcqPm/2jRQ3bDtnbjXNxC4qRnP6hM92+/C8oRAPI07zmeWK2CZL8glVMpHg==';

async function importPhrase(page: Page, phrase: string) {
  const importTab = page.getByRole('tab', { name: 'Import Existing' });
  await expect(importTab).toBeVisible({ timeout: 10000 });
  await importTab.click();
  await page.locator('#mnemonic-input').fill(phrase);
  await page.getByRole('button', { name: 'Import & Continue' }).click();
}

async function readStoredIdentity(page: Page, userId: string) {
  return page.evaluate(async (idbUserId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(`channel-keys-v1-${idbUserId}`, 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    });

    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const read = <T>(key: string) => new Promise<T | undefined>((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error ?? new Error(`IDB read failed for ${key}`));
    });

    const [deviceId, privateJwk, publicJwk, publicKeySpki, legacyKeyPair] = await Promise.all([
      read<string>('deviceId'),
      read<JsonWebKey>('ecdhPrivateJwk'),
      read<JsonWebKey>('ecdhPublicJwk'),
      read<string>('publicKeySpki'),
      read<unknown>('ecdhKeyPair'),
    ]);

    return {
      deviceId,
      privateJwk,
      publicJwk,
      publicKeySpki,
      hasLegacyKeyPair: legacyKeyPair !== undefined,
    };
  }, userId);
}

test.describe('Key setup page', () => {
  test('signed-in user without keys can access the key setup page', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/keys');
    await expect(page.getByText('Set Up Encryption Keys')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Generate New' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Import Existing' })).toBeVisible();
  });

  test('generate flow requires confirmation before continuing', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/keys');

    const createButton = page.getByRole('button', { name: 'Create Account' });
    await expect(createButton).toBeDisabled();

    await page.getByLabel(/I have safely written down or stored my 24-word recovery phrase offline/i).check();
    await expect(createButton).toBeEnabled();
  });

  test('generate flow persists keys and redirects into the signed-in app', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/keys');

    await page.getByLabel(/I have safely written down or stored my 24-word recovery phrase offline/i).check();
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 10000 });
  });

  test('import flow stays disabled until 24 words are entered and rejects invalid phrases', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/keys');

    await page.getByRole('tab', { name: 'Import Existing' }).click();
    const importButton = page.getByRole('button', { name: 'Import & Continue' });

    await expect(importButton).toBeDisabled();
    await page.locator('#mnemonic-input').fill('too short');
    await expect(importButton).toBeDisabled();

    await page.locator('#mnemonic-input').fill(INVALID_24_WORD_PHRASE);
    await expect(importButton).toBeEnabled();
    await importButton.click();

    await expect(page.getByText(/Invalid recovery phrase/i)).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/#\/keys$/);
  });

  test('same recovery phrase stores the exact browser-derived identity', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/keys');

    await importPhrase(page, VALID_24_WORD_PHRASE);
    await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 10000 });
    const stored = await readStoredIdentity(page, 'test-user-id');
    const derived = await page.evaluate(async (phrase) => {
      const { deriveDeviceIdentity } = await import('/src/crypto/mnemonicKey.ts');
      const identity = await deriveDeviceIdentity(phrase);
      return {
        deviceId: identity.deviceId,
        privateJwk: identity.privateKeyJwk,
        publicJwk: identity.publicKeyJwk,
        publicKeySpki: identity.publicKeySpki,
      };
    }, VALID_24_WORD_PHRASE);

    expect(stored.hasLegacyKeyPair).toBe(false);
    expect(stored.deviceId).toBe(derived.deviceId);
    expect(stored.privateJwk).toEqual(derived.privateJwk);
    expect(stored.publicJwk).toEqual(derived.publicJwk);
    expect(stored.publicKeySpki).toBe(derived.publicKeySpki);
    expect(derived.deviceId).toBe(EXPECTED_DEVICE_ID);
    expect(derived.privateJwk).toEqual(EXPECTED_PRIVATE_JWK);
    expect(derived.publicJwk).toEqual(EXPECTED_PUBLIC_JWK);
    expect(derived.publicKeySpki).toBe(EXPECTED_PUBLIC_KEY_SPKI);
  });

  test('imported keys survive reloads using the serialized IndexedDB format', async ({ page }) => {
    await bootstrapSignedIn(page);
    await page.goto('/#/keys');

    await importPhrase(page, VALID_24_WORD_PHRASE);
    await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 10000 });

    const stored = await readStoredIdentity(page, 'test-user-id');
    expect(stored.hasLegacyKeyPair).toBe(false);
    expect(stored.deviceId).toBeTruthy();
    expect(stored.publicKeySpki).toBeTruthy();

    await page.reload();
    await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 10000 });
  });
});
