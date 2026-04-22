import { test, expect } from '@playwright/test';
import { bootstrapSignedIn } from './fixtures/index';

const INVALID_24_WORD_PHRASE = Array(24).fill('hello').join(' ');

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
});
