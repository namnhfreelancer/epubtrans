import { expect, test } from '@playwright/test';
import { MOCK_BASE } from './support/mock-provider';

test('lists every provider preset and only lets the custom preset edit its base URL', async ({ page }) => {
  await page.goto('/#/settings');
  const options = await page.locator('#provider option').allTextContents();
  for (const label of ['Anthropic', 'OpenAI', 'Gemini', 'OpenRouter', 'DeepSeek', 'Custom']) expect(options.join('|')).toContain(label);
  await page.locator('#provider').selectOption('openrouter');
  await expect(page.locator('#base-url')).toHaveValue('https://openrouter.ai/api/v1');
  await expect(page.locator('#base-url')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('key-note')).toContainText('only sent to openrouter.ai');
  await page.locator('#provider').selectOption('custom');
  await page.locator('#base-url').fill(MOCK_BASE);
  await expect(page.getByTestId('key-note')).toContainText('only sent to mock-provider.test');
  await page.locator('#model-id').fill('any-model-typed-by-hand');
  await page.reload();
  await expect(page.locator('#provider')).toHaveValue('custom');
  await expect(page.locator('#model-id')).toHaveValue('any-model-typed-by-hand');
});

test('API key stays in memory unless "remember" is checked, and can be cleared', async ({ page }) => {
  await page.goto('/#/settings');
  await page.locator('#provider').selectOption('openai');
  await expect(page.locator('#api-key')).toHaveAttribute('type', 'password');
  await page.locator('#api-key').fill('sk-memory-only');
  await page.reload();
  await expect(page.locator('#api-key')).toHaveValue('');

  // Remembering is opt-in and warns that the Pages origin is shared with other sites.
  await expect(page.getByLabel('Remember key on this device')).not.toBeChecked();
  await expect(page.getByTestId('remember-warning')).toContainText('other sites by the same owner');
  await page.locator('#api-key').fill('sk-remembered');
  await page.getByLabel('Remember key on this device').check();
  await page.reload();
  await expect(page.locator('#api-key')).toHaveValue('sk-remembered');
  expect(await page.evaluate(() => localStorage.getItem('epubtrans:apiKey:openai'))).toBe('sk-remembered');

  await page.getByRole('button', { name: 'Clear key' }).click();
  await expect(page.locator('#api-key')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('epubtrans:apiKey:openai'))).toBeNull();
});

test('switches the UI between English and Vietnamese and remembers the choice', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await page.getByTestId('locale-switcher').selectOption('vi');
  await expect(page.getByRole('heading', { name: 'Thư viện của bạn' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cài đặt', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Thư viện của bạn' })).toBeVisible();
  await page.getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nhà cung cấp AI' })).toBeVisible();
  await page.getByTestId('locale-switcher').selectOption('en');
  await expect(page.getByRole('heading', { name: 'AI provider' })).toBeVisible();
});

test.describe('Vietnamese browser', () => {
  test.use({ locale: 'vi-VN' });
  test('defaults to Vietnamese from navigator.language', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'Thư viện của bạn' })).toBeVisible();
  });
});
