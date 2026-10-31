import { expect, type Page, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, totalSegments } from './support/app-helpers';
import { installMockProvider, translatedIds } from './support/mock-provider';

const viewerIds = (page: Page) => page.getByTestId('sample-segment').evaluateAll((els) => els.map((el) => el.getAttribute('data-segment-id') ?? ''));
const seedText = (page: Page) =>
  page
    .getByTestId('sample-viewer')
    .getByText(/^Seed \d+$/)
    .textContent();

test('translates samples, shows them side by side, translates them again, then the full run skips them', async ({ page }) => {
  const mock = await installMockProvider(page, { delayMs: 300 });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  const total = await totalSegments(page);

  // The fixture has three chapters with enough text for a sample.
  await expect(page.getByTestId('sample-estimate')).toContainText(/≈ [\d,]+ input \+ [\d,]+ output tokens/);
  await page.locator('#sample-passages').fill('3');
  await page.getByTestId('sample-translate').click();

  // While samples run the full translation cannot start.
  await expect(page.getByTestId('sample-progress')).toBeVisible();
  await expect(page.getByTestId('start-translation')).toBeDisabled();
  await expect(page.getByTestId('sample-complete')).toBeVisible();
  await expect(page.getByTestId('start-translation')).toBeEnabled();

  await expect(page.getByTestId('sample-passage')).toHaveCount(3);
  const ids = await viewerIds(page);
  expect(ids.length).toBeGreaterThan(3);
  expect(translatedIds(mock).sort()).toEqual([...ids].sort());
  await expect(page.getByTestId('sample-passage').first().getByRole('heading', { level: 4 })).toContainText('Passage 1:');
  for (const translation of await page.getByTestId('sample-translation').allTextContents()) expect(translation).toContain('[vi]');
  await expect(page.getByTestId('run-progress')).toHaveText(`${ids.length} / ${total} segments`);

  // Again: the same segments are sent once more and shown with the new text.
  mock.prefix = '[again] ';
  const beforeAgain = mock.segmentRequests.length;
  const seed = await seedText(page);
  await page.getByTestId('sample-again').click();
  await expect(page.getByTestId('sample-translation').first()).toContainText('[again]');
  await expect(page.getByTestId('sample-complete')).toBeVisible();
  expect(translatedIds(mock, beforeAgain).sort()).toEqual([...ids].sort());
  expect(await viewerIds(page)).toEqual(ids);
  expect(await seedText(page)).toBe(seed);

  // New random samples: another seed, three passages again.
  mock.prefix = '[new] ';
  const beforeNew = mock.segmentRequests.length;
  await page.getByTestId('sample-new').click();
  await expect(page.getByTestId('sample-translation').first()).toContainText('[new]');
  await expect(page.getByTestId('sample-complete')).toBeVisible();
  await expect(page.getByTestId('sample-passage')).toHaveCount(3);
  expect(await seedText(page)).not.toBe(seed);
  const current = await viewerIds(page);
  expect(translatedIds(mock, beforeNew).sort()).toEqual([...current].sort());

  // The selection and its translations survive a reload.
  await page.reload();
  await expect(page.getByTestId('sample-passage')).toHaveCount(3);
  expect(await viewerIds(page)).toEqual(current);
  await expect(page.getByTestId('sample-translation').first()).toContainText('[new]');

  // Full run: segments of both samples are already translated and skipped; the sample cannot be started meanwhile.
  const alreadyTranslated = new Set([...ids, ...current]);
  mock.prefix = '[vi] ';
  const beforeFull = mock.segmentRequests.length;
  await page.getByTestId('start-translation').click();
  await expect(page.getByTestId('sample-new')).toBeDisabled();
  await expect(page.getByTestId('sample-again')).toBeDisabled();
  await expect(page.getByTestId('run-complete')).toBeVisible({ timeout: 90_000 });
  const sent = translatedIds(mock, beforeFull);
  expect(sent.some((id) => alreadyTranslated.has(id))).toBe(false);
  expect(sent.length + alreadyTranslated.size).toBe(total);
  await expect(page.getByTestId('sample-new')).toBeEnabled();
  await expect(page.getByTestId('sample-translation').first()).toContainText('[new]');
});

test('a sample re-run that partly fails warns and labels failed and hand-edited segments; a fully failed one is an error', async ({ page }) => {
  const mock = await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await page.locator('#sample-passages').fill('2');
  await page.getByTestId('sample-translate').click();
  await expect(page.getByTestId('sample-complete')).toBeVisible();
  const [failedId = '', editedId = '', ...rest] = await viewerIds(page);
  expect(rest.length).toBeGreaterThan(0);
  const sampleSegment = (id: string) => page.locator(`[data-testid="sample-segment"][data-segment-id="${id}"]`);

  // Edit one sampled segment by hand in the reader, then come back to the setup page.
  await page.evaluate((id) => {
    window.location.hash = window.location.hash.replace(/\/setup$/, `/read/${encodeURIComponent(id)}`);
  }, editedId);
  const row = page.locator(`[data-testid="segment-row"][data-segment-id="${editedId}"]`);
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByTestId('segment-editor').fill('Bản tôi tự sửa');
  await row.getByTestId('segment-editor').blur();
  await expect(row.getByTestId('segment-translation')).toHaveText('Bản tôi tự sửa');
  await page.getByRole('link', { name: 'Translate', exact: true }).click();

  // Again, with one segment answered invalidly: a warning instead of the success message, and labels.
  mock.invalidIds.add(failedId);
  mock.prefix = '[again] ';
  const before = mock.segmentRequests.length;
  await page.getByTestId('sample-again').click();
  await expect(page.getByTestId('sample-partly-failed')).toHaveText(
    '1 sample segments failed and kept their previous translation (segments without one are marked as errors). They are labelled below.',
  );
  await expect(page.getByTestId('sample-kept-edited')).toHaveText(' 1 hand-edited segments were kept.');
  await expect(page.getByTestId('sample-complete')).toHaveCount(0);
  expect(translatedIds(mock, before)).not.toContain(editedId);

  await expect(sampleSegment(failedId).getByTestId('sample-badge-failed')).toHaveText('Failed – earlier translation shown');
  await expect(sampleSegment(failedId).getByTestId('sample-translation')).toContainText('[vi]');
  await expect(sampleSegment(editedId).getByTestId('sample-badge-edited')).toHaveText('Edited by hand – not resampled');
  await expect(sampleSegment(editedId).getByTestId('sample-translation')).toContainText('Bản tôi tự sửa');
  for (const id of rest) {
    await expect(sampleSegment(id).getByTestId('sample-translation')).toContainText('[again]');
    await expect(sampleSegment(id).locator('[data-testid^="sample-badge-"]')).toHaveCount(0);
  }

  // Every segment that was sent fails: the run ends as an error, earlier translations stay.
  mock.invalidAll = true;
  await page.getByTestId('sample-again').click();
  await expect(page.getByTestId('sample-all-failed')).toContainText(`All ${rest.length + 1} sample segments failed`);
  await expect(page.getByTestId('sample-partly-failed')).toHaveCount(0);
  await expect(page.getByTestId('sample-complete')).toHaveCount(0);
  await expect(sampleSegment(rest[0] ?? '').getByTestId('sample-badge-failed')).toHaveText('Failed – earlier translation shown');
  await expect(sampleSegment(rest[0] ?? '').getByTestId('sample-translation')).toContainText('[again]');
});
