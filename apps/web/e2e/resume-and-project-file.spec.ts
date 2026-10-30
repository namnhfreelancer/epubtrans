import { expect, test } from '@playwright/test';
import {
  configureMockProvider,
  FIXTURES,
  importBook,
  openFirstBook,
  persistedSegments,
  readDownload,
  totalSegments,
  translateAll,
} from './support/app-helpers';
import { installMockProvider, translatedIds } from './support/mock-provider';

test('reloading mid-translation resumes without resending finished segments', async ({ page }) => {
  const mock = await installMockProvider(page, { delayMs: 350 });
  await configureMockProvider(page, 'sk-test-resume', { remember: true });
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await page.locator('#concurrency').fill('1');
  const total = await totalSegments(page);

  await page.getByTestId('start-translation').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => (await persistedSegments(page)).filter((s) => s.status === 'translated').length, { timeout: 30_000 }).toBeGreaterThanOrEqual(5);

  await page.reload();
  const finished = new Set((await persistedSegments(page)).filter((s) => s.status === 'translated').map((s) => s.id));
  expect(finished.size).toBeGreaterThan(0);
  expect(finished.size).toBeLessThan(total);
  await expect(page.getByTestId('run-progress')).toHaveText(`${finished.size} / ${total} segments`);

  const sentBeforeResume = mock.segmentRequests.length;
  mock.delayMs = 0;
  await expect(page.getByTestId('start-translation')).toHaveText('Resume');
  await translateAll(page);

  const resent = translatedIds(mock, sentBeforeResume);
  expect(resent.filter((id) => finished.has(id))).toEqual([]);
  expect(new Set([...finished, ...resent]).size).toBe(total);
  await expect(page.getByTestId('run-progress')).toHaveText(`${total} / ${total} segments`);
});

test('pause stops the run and resume continues it', async ({ page }) => {
  const mock = await installMockProvider(page, { delayMs: 250 });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.fb2);
  await openFirstBook(page);
  await page.locator('#concurrency').fill('1');
  await page.getByTestId('start-translation').click();
  await expect.poll(async () => (await persistedSegments(page)).length).toBeGreaterThan(0);

  // While the job runs, the reader locks Edit and Retranslate: the run would overwrite such a change.
  await page.getByRole('link', { name: 'Read & edit' }).click();
  const edit = page.getByTestId('segment-row').first().getByRole('button', { name: 'Edit' });
  await expect(edit).toBeDisabled();
  await expect(edit).toHaveAttribute('title', /being translated/);
  await expect(page.getByTestId('segment-row').first().getByRole('button', { name: 'Retranslate' })).toBeDisabled();
  await page.goBack();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused. Finished segments are saved')).toBeVisible();
  const afterPause = mock.segmentRequests.length;
  await page.waitForTimeout(600);
  expect(mock.segmentRequests.length).toBe(afterPause);
  await page.getByRole('link', { name: 'Read & edit' }).click();
  await expect(edit).toBeEnabled();
  await expect(edit).not.toHaveAttribute('title');
  await page.goBack();
  mock.delayMs = 0;
  await translateAll(page);
});

test('project file export, delete and import round trip keeps translations', async ({ page }) => {
  await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.fb2);
  await openFirstBook(page);
  const total = await totalSegments(page);
  await translateAll(page);

  await page.goto('/#/');
  const card = page.getByTestId('book-card');
  await expect(card.getByTestId('book-progress')).toHaveText(`${total} / ${total} segments`);
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Export project' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.epubtrans$/);
  const bytes = await readDownload(download);
  expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');
  const saved = await download.path();

  page.once('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(0);
  expect(await persistedSegments(page)).toEqual([]);

  await page.getByTestId('book-file-input').setInputFiles({ name: 'restored.epubtrans', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await expect(page.getByTestId('book-card').getByTestId('book-progress')).toHaveText(`${total} / ${total} segments`);
  await openFirstBook(page);
  await page.getByRole('link', { name: 'Read & edit' }).click();
  await expect(page.getByTestId('segment-translation').first()).toContainText('[vi]');
  expect(saved).toBeTruthy();
});
