import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, readDownload, translateAll } from './support/app-helpers';
import { installMockPricing, LITELLM_PRICES_URL, OPENROUTER_MODELS_URL } from './support/mock-pricing';
import { installMockProvider, MOCK_BASE } from './support/mock-provider';

const KEY = 'sk-test-LEAKCHECK-123';
const APP_ORIGIN = 'http://localhost:4317/';
const PRICE_URLS = [OPENROUTER_MODELS_URL, LITELLM_PRICES_URL];

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

test('the API key is only ever sent to the configured provider base URL, never to the price catalogs', async ({ page, context }) => {
  const pending: Promise<RecordedRequest>[] = [];
  context.on('request', (req) => {
    pending.push(
      (async () => ({
        url: req.url(),
        headers: await req.allHeaders().catch(() => req.headers()),
        body: req.postData() ?? '',
      }))(),
    );
  });

  const mock = await installMockProvider(page);
  // Registered after the provider mock so it takes over the price hosts and records what they receive.
  const pricing = await installMockPricing(page);
  await configureMockProvider(page, KEY, { remember: true });
  // Not in the OpenRouter fixture, so the lookup also reaches the LiteLLM host.
  await page.locator('#model-id').fill('mock-lite-only');
  await importBook(page, FIXTURES.fb2);
  await openFirstBook(page);
  await expect(page.getByTestId('price-source')).toContainText('Price from LiteLLM (matched: mock-lite-only)');
  await page.getByRole('button', { name: 'Generate guideline & glossary' }).click();
  await expect(page.getByText('Guideline and glossary generated.')).toBeVisible();
  await translateAll(page);
  await page.getByRole('link', { name: 'Read & edit' }).click();
  await page.getByTestId('segment-row').first().getByRole('button', { name: 'Retranslate' }).click();
  await expect(page.getByTestId('segment-row').first().getByRole('button', { name: 'Retranslate' })).toBeEnabled();
  await page.reload();
  await page.getByRole('link', { name: 'Export' }).click();
  const [epub] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-epub').click()]);
  const [projectFile] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-project').click()]);

  const requests = await Promise.all(pending);
  expect(mock.segmentRequests.length).toBeGreaterThan(1);

  const carriesKey = (r: RecordedRequest) =>
    r.url.includes(KEY) || decodeURIComponent(r.url).includes(KEY) || Object.values(r.headers).some((v) => v.includes(KEY)) || r.body.includes(KEY);
  const withKey = requests.filter(carriesKey);
  expect(withKey.length).toBeGreaterThan(0);
  for (const r of withKey) {
    expect(r.url.startsWith(`${MOCK_BASE}/`), `key sent to ${r.url}`).toBe(true);
    expect(r.headers.authorization).toBe(`Bearer ${KEY}`);
  }
  // The public price catalogs were queried (both hosts) and are the only other hosts allowed.
  const priceRequests = requests.filter((r) => PRICE_URLS.includes(r.url));
  expect(new Set(priceRequests.map((r) => r.url))).toEqual(new Set(PRICE_URLS));
  expect(pricing.requests.length).toBeGreaterThanOrEqual(2);
  for (const r of priceRequests) {
    expect(carriesKey(r), `key sent to price host ${r.url}`).toBe(false);
    expect(Object.keys(r.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(r.headers).map((h) => h.toLowerCase())).not.toContain('cookie');
    expect(r.body).toBe('');
  }
  for (const r of requests) {
    expect(decodeURIComponent(r.url), 'key must never appear in a URL').not.toContain(KEY);
    // No analytics, fonts or CDNs: only the app itself, the provider and the two public price catalogs.
    const allowed =
      r.url.startsWith(APP_ORIGIN) || r.url.startsWith(`${MOCK_BASE}/`) || r.url.startsWith('blob:') || r.url.startsWith('data:') || PRICE_URLS.includes(r.url);
    expect(allowed, `unexpected request to ${r.url}`).toBe(true);
  }

  // Exported artifacts never embed the key.
  for (const download of [epub, projectFile]) {
    const files = unzipSync(await readDownload(download));
    for (const [name, bytes] of Object.entries(files)) expect(strFromU8(bytes, true).includes(KEY), name).toBe(false);
  }
});
