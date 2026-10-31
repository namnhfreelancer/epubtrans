import { expect, type Page, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook } from './support/app-helpers';
import { installMockPricing, LITELLM_PRICES_URL, OPENROUTER_MODELS_URL } from './support/mock-pricing';
import { installMockProvider } from './support/mock-provider';

async function setModel(page: Page, model: string): Promise<void> {
  await page.goto('/#/settings');
  await page.locator('#model-id').fill(model);
  await page.goto('/#/');
  await openFirstBook(page);
}

test('prices are looked up for the model, cached, and overridden by manual input', async ({ page }) => {
  await installMockProvider(page);
  const pricing = await installMockPricing(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);

  // Unknown model: manual fallback, no estimate in USD.
  await expect(page.getByTestId('price-source')).toContainText('No public price found — enter it manually.');
  await expect(page.getByTestId('cost-estimate')).toContainText('Enter prices to see the cost.');

  // OpenRouter match: normalized name, fills the estimate without persisting anything automatic.
  await setModel(page, 'mock-model-pro');
  await expect(page.getByTestId('price-source')).toContainText('Price from OpenRouter (matched: mock-lab/mock-model-pro)');
  await expect(page.locator('#price-in')).toHaveAttribute('placeholder', '2');
  await expect(page.locator('#price-out')).toHaveAttribute('placeholder', '10');
  await expect(page.locator('#price-in')).toHaveValue('');
  await expect(page.getByTestId('cost-estimate')).toContainText('≈ $');

  // LiteLLM is the fallback when OpenRouter has no match.
  await setModel(page, 'mock-lite-only');
  await expect(page.getByTestId('price-source')).toContainText('Price from LiteLLM (matched: mock-lite-only)');
  await expect(page.locator('#price-in')).toHaveAttribute('placeholder', '0.4');

  // The catalogs were downloaded once each and then served from the 24h cache.
  const urls = pricing.requests.map((r) => r.url());
  expect(urls.filter((u) => u === OPENROUTER_MODELS_URL)).toHaveLength(1);
  expect(urls.filter((u) => u === LITELLM_PRICES_URL)).toHaveLength(1);
  const cached = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('epubtrans:pricing:')));
  expect(cached.length).toBe(2);

  // A manual price wins, persists with the book, and can be reset to the automatic one.
  await page.locator('#price-in').fill('7');
  await page.locator('#price-in').blur();
  await expect(page.getByTestId('price-source')).toContainText('Your manual price is used.');
  await page.reload();
  await expect(page.locator('#price-in')).toHaveValue('7');
  await page.getByRole('button', { name: 'Use the automatic price' }).click();
  await expect(page.locator('#price-in')).toHaveValue('');
  await expect(page.getByTestId('price-source')).not.toContainText('Your manual price is used.');
});

test('an unreachable price source falls back to manual entry without an error', async ({ page }) => {
  await installMockProvider(page);
  await page.route(OPENROUTER_MODELS_URL, (route) => route.abort('failed'));
  await page.route(LITELLM_PRICES_URL, (route) => route.fulfill({ status: 500, body: 'down' }));
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await expect(page.getByTestId('price-source')).toContainText('No public price found — enter it manually.');
  await page.locator('#price-in').fill('3');
  await page.locator('#price-in').blur();
  await page.locator('#price-out').fill('15');
  await page.locator('#price-out').blur();
  await expect(page.getByTestId('cost-estimate')).toContainText('≈ $');
});
