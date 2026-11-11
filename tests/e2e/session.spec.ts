import { test, expect } from '@playwright/test';
test('demo member logs in, reloads, and logs out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to your space.' })).toBeVisible();
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByLabel(/Password/).fill('demo-only');
  await page.getByRole('button', { name: /Enter workspace/ }).click();
  await expect(page.getByRole('heading', { name: 'A fresh beginning.' })).toBeVisible();
  await expect(page.getByText('Jamie', { exact: true })).toBeVisible();
  await expect(page.getByText('Workspace API connected')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A fresh beginning.' })).toBeVisible();
  await page.getByRole('button', { name: /Log out/ }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your name')).toBeVisible();
});
test('mobile shell has usable navigation and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByRole('button', { name: /Enter workspace/ }).click();
  await expect(page.getByRole('heading', { name: 'A fresh beginning.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: /Log out/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
