import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { checkMobile, snap } from './helpers';

test('validate, preview playback and download a corrected file', async ({ page }) => {
  await page.goto('./');
  await page.waitForTimeout(1000);
  await snap(page, 'landing');
  await checkMobile(page, 'landing-mobile');
  await page.getByRole('link', { name: 'Check a caption file' }).first().click();
  await page.getByRole('listitem', { name: /Cue 2,/ }).click();
  await expect(page.locator('.captions')).toContainText('four ripe tomatoes');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Pause' }).click();
  await snap(page, 'check');
  await checkMobile(page);

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download fixed .vtt' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('demo-tomato-soup-fixed.vtt');
  const out = readFileSync(await file.path(), 'utf8');
  expect(out.startsWith('WEBVTT')).toBe(true);
  expect(out).not.toContain(',000');
  await expect(page.getByText(/Downloaded demo-tomato-soup-fixed.vtt/)).toBeVisible();
});
