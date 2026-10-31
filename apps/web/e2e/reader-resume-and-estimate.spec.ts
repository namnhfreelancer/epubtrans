import { expect, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, totalSegments } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';

test("the reader's retry does not start a full run while segments are pending: it opens the setup page instead", async ({ page }) => {
  const mock = await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  const total = await totalSegments(page);

  // Every sampled segment fails, the rest of the book was never translated.
  mock.invalidAll = true;
  await page.locator('#sample-passages').fill('2');
  await page.getByTestId('sample-translate').click();
  await expect(page.getByTestId('sample-complete')).toBeVisible({ timeout: 90_000 });
  const failed = Number(/(\d+)/.exec((await page.getByTestId('run-errors').textContent()) ?? '')?.[1]);
  expect(failed).toBeGreaterThan(0);
  const pending = total - failed;
  expect(pending).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Read & edit' }).click();
  const button = page.getByTestId('retry-all-failed');
  await expect(button).toHaveText(`Resume translation (${pending} pending, ${failed} failed)`);
  await expect(button).toBeEnabled();

  mock.invalidAll = false;
  const requestsBefore = mock.segmentRequests.length;
  await button.click();
  // The setup page shows the estimate and Start; nothing was sent for the failed or the pending segments.
  await expect(page.getByTestId('start-translation')).toBeVisible();
  await expect(page.getByTestId('cost-estimate')).toBeVisible();
  await page.waitForTimeout(600);
  expect(mock.segmentRequests.length).toBe(requestsBefore);
  await expect(page.getByTestId('run-progress')).toHaveText(`0 / ${total} segments`);
});

test('the guideline, glossary and preset picker are locked while guide generation runs', async ({ page }) => {
  // Slow answers keep generation running long enough to observe the locked state.
  await installMockProvider(page, { delayMs: 1500 });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await expect(page.locator('#guideline')).toBeEnabled();

  await page.getByRole('button', { name: 'Generate guideline & glossary' }).click();
  await expect(page.getByTestId('guide-locked-hint')).toContainText('Generating…');
  await expect(page.locator('#guideline')).toBeDisabled();
  await expect(page.locator('#guideline-preset')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Use preset' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add term' })).toBeDisabled();

  await expect(page.getByText('Guideline and glossary generated.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('guide-locked-hint')).toHaveCount(0);
  await expect(page.locator('#guideline')).toBeEnabled();
  await expect(page.locator('#guideline-preset')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add term' })).toBeEnabled();
});

test('the cost estimate is not refreshed while a run translates, and is updated once it ends', async ({ page }) => {
  await installMockProvider(page, { delayMs: 800 });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await expect(page.getByTestId('cost-estimate')).toContainText(/input \+ [\d,]+ output tokens/);
  await expect(page.getByTestId('estimate-deferred')).toHaveCount(0);

  await page.getByTestId('start-translation').click();
  await expect(page.getByTestId('estimate-deferred')).toHaveText('The estimate updates after the run.');
  await expect(page.getByTestId('cost-estimate')).toContainText(/input \+ [\d,]+ output tokens/);

  await expect(page.getByTestId('run-complete')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('estimate-deferred')).toHaveCount(0);
  await expect(page.getByTestId('cost-estimate')).toHaveText('Nothing left to translate.');
});
