import { expect, type Page, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, persistedSegments } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';

/** Segment ids of every chapter, read from the reader (all segments are listed even before translation). */
async function segmentIdsByChapter(page: Page): Promise<string[][]> {
  const items = page.getByTestId('chapter-item');
  // The chapter list renders after the book loads; counting earlier sees no chapters.
  await expect(items.first()).toBeVisible();
  const result: string[][] = [];
  for (let i = 0; i < (await items.count()); i++) {
    await items.nth(i).click();
    await expect(items.nth(i)).toHaveAttribute('aria-current', 'true');
    result.push(await page.getByTestId('segment-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-segment-id') ?? '')));
  }
  return result;
}

const activeChapterTitle = (page: Page) => page.getByRole('navigation', { name: 'Chapters' }).locator('[aria-current="true"]');
const row = (page: Page, id: string) => page.locator(`[data-segment-id="${id}"]`);

test('finds failed segments in the chapter list, jumps between them, filters, and retries them all', async ({ page }) => {
  const mock = await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await page.getByRole('link', { name: 'Read & edit' }).click();

  // Fail segments in three different chapters (two in the first one) so navigation has to cross chapters.
  const chapters = (await segmentIdsByChapter(page)).map((ids, index) => ({ ids, index })).filter((c) => c.ids.length > 0);
  expect(chapters.length).toBeGreaterThanOrEqual(3);
  const [first, second, third] = chapters;
  const failing = [first?.ids[0], first?.ids[first.ids.length - 1], second?.ids[0], third?.ids[0]].filter((id): id is string => Boolean(id));
  // A chapter with one segment contributes it once.
  const failedIds = [...new Set(failing)];
  for (const id of failedIds) mock.invalidIds.add(id);
  const errorChapters = new Set([first?.index, second?.index, third?.index]).size;
  expect(errorChapters).toBe(3);

  // Translate: the invalid answers end in `error`.
  await page.getByRole('link', { name: 'Translate' }).click();
  await expect(page.getByTestId('start-translation')).toBeVisible();
  await page.getByTestId('start-translation').click();
  await expect(page.getByTestId('run-errors')).toHaveText(`${failedIds.length} segments failed`, { timeout: 90_000 });
  await expect(page.getByTestId('start-translation')).toHaveText('Retry failed segments');

  // Reader: chapter badges and the summary.
  await page.getByRole('link', { name: 'Read & edit' }).click();
  const total = failedIds.length;
  await expect(page.getByTestId('error-summary')).toHaveText(`${total} errors in 3 chapters`);
  const flagged = page.locator('[data-testid="chapter-item"]:not([data-errors="0"])');
  await expect(flagged).toHaveCount(3);
  await expect(flagged.first().getByTestId('chapter-error-badge')).toHaveAttribute('aria-label', /^\d+ errors?$/);
  await expect(page.locator('[data-testid="chapter-item"][data-errors="0"] [data-testid="chapter-error-badge"]')).toHaveCount(0);
  const badgeTotal = await flagged.evaluateAll((items) => items.reduce((n, el) => n + Number(el.getAttribute('data-errors')), 0));
  expect(badgeTotal).toBe(total);

  // Next / Previous across chapters; stops at both ends.
  const prev = page.getByTestId('prev-error');
  const next = page.getByTestId('next-error');
  const position = page.getByTestId('error-position');
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  const seenChapters: (string | null)[] = [];
  for (let n = 1; n <= total; n++) {
    await next.click();
    const id = failedIds[n - 1] as string;
    await expect(position).toHaveText(`Error ${n} of ${total}`);
    await expect(page).toHaveURL(new RegExp(`#/book/[^/]+/read/${id}$`));
    await expect(row(page, id)).toBeFocused();
    await expect(row(page, id)).toBeInViewport();
    seenChapters.push(await activeChapterTitle(page).textContent());
  }
  expect(new Set(seenChapters).size).toBe(3);
  await expect(next).toBeDisabled();
  await expect(prev).toBeEnabled();

  // Keyboard: `[` goes back, `]` forward.
  await page.keyboard.press('[');
  await expect(position).toHaveText(`Error ${total - 1} of ${total}`);
  await expect(row(page, failedIds[total - 2] as string)).toBeFocused();
  await page.keyboard.press(']');
  await expect(position).toHaveText(`Error ${total} of ${total}`);
  await prev.click();
  await expect(position).toHaveText(`Error ${total - 1} of ${total}`);

  // The shortcut types normally while a field has focus (it must not jump).
  const plain = page.locator('[data-testid="segment-row"]:not([data-status="error"])').first();
  await expect(plain).toBeVisible();
  await plain.getByRole('button', { name: 'Edit' }).click();
  await page.keyboard.type(']');
  await expect(plain.getByTestId('segment-editor')).toHaveValue(/\]/);
  await expect(position).toHaveText(`Error ${total - 1} of ${total}`);
  await plain.getByTestId('segment-editor').blur();

  // The link survives a reload and re-opens the same error.
  const deepLinked = failedIds[total - 2] as string;
  await page.reload();
  await expect(row(page, deepLinked)).toBeFocused();
  await expect(position).toHaveText(`Error ${total - 1} of ${total}`);

  // A failed row shows its message once, wrapped, with Edit and Retranslate still available.
  const failedRow = row(page, deepLinked);
  await expect(failedRow.getByTestId('segment-status')).toHaveText('Error');
  await expect(failedRow.getByTestId('segment-error')).toHaveCount(1);
  await expect(failedRow.getByTestId('segment-error')).not.toContainText(/Retranslation failed/i);
  await expect(failedRow.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(failedRow.getByRole('button', { name: 'Retranslate' })).toBeVisible();

  // Retranslating a failed row that fails again shows the failure once, without a doubled prefix.
  await failedRow.getByRole('button', { name: 'Retranslate' }).click();
  await expect(failedRow.getByRole('alert')).toContainText(/^Retranslation failed: /);
  await expect(failedRow.getByRole('alert')).not.toContainText(/Retranslation failed:.*Retranslation failed:/i);
  await expect(failedRow.getByTestId('segment-error')).toHaveCount(1);

  // Errors-only filter: only failed chapters are listed and only failed rows shown.
  await page.getByTestId('only-errors').check();
  await expect(page.getByTestId('chapter-item')).toHaveCount(3);
  const statuses = await page.getByTestId('segment-status').allTextContents();
  expect(statuses.length).toBeGreaterThan(0);
  expect(new Set(statuses)).toEqual(new Set(['Error']));
  await page.getByTestId('only-errors').uncheck();
  expect(await page.getByTestId('chapter-item').count()).toBeGreaterThan(3);

  // Retry all failed, with the mock now answering validly. The reader locks edits meanwhile.
  mock.invalidIds.clear();
  mock.delayMs = 400;
  const retry = page.getByTestId('retry-all-failed');
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(page.getByTestId('segment-row').first().getByRole('button', { name: 'Edit' })).toBeDisabled();
  await expect(page.getByTestId('error-summary')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByTestId('chapter-error-badge')).toHaveCount(0);
  await expect(page.getByTestId('retry-all-failed')).toHaveCount(0);
  await expect(page.getByTestId('segment-row').first().getByRole('button', { name: 'Edit' })).toBeEnabled();

  const stored = await persistedSegments(page);
  expect(stored.filter((s) => s.status === 'error')).toEqual([]);
});
