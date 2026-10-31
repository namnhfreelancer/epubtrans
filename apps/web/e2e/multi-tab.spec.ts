import { expect, type Page, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, persistedSegments } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';

// Pages of one browser context share the origin, hence IndexedDB, Web Locks and BroadcastChannel: two tabs.

/** Opens the book shown in `tabA` in a second tab of the same browser context. */
async function openSecondTab(tabA: Page): Promise<Page> {
  const tabB = await tabA.context().newPage();
  await tabB.goto(tabA.url());
  await expect(tabB.getByTestId('book-title')).toBeVisible();
  return tabB;
}

test('only one tab can translate a book at a time, and the other tab locks its editor', async ({ page: tabA }) => {
  await installMockProvider(tabA, { delayMs: 1500 });
  await configureMockProvider(tabA);
  await importBook(tabA, FIXTURES.epub);
  await openFirstBook(tabA);
  const tabB = await openSecondTab(tabA);
  const startB = tabB.getByTestId('start-translation');
  await expect(startB).toBeEnabled();
  await expect(tabB.getByTestId('run-busy-elsewhere')).toHaveCount(0);

  await tabA.getByTestId('start-translation').click();
  await expect(tabA.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(startB).toBeDisabled();
  await expect(tabB.getByTestId('run-busy-elsewhere')).toHaveText(
    'This book is being translated in another tab. Pause it there or wait until it finishes to start here.',
  );

  await tabB.getByRole('link', { name: 'Read & edit' }).click();
  const firstRowB = tabB.getByTestId('segment-row').first();
  await expect(firstRowB.getByRole('button', { name: 'Edit' })).toBeDisabled();
  await expect(firstRowB.getByRole('button', { name: 'Retranslate' })).toBeDisabled();

  // Pausing in tab A releases the lock: tab B can edit and start again.
  await tabA.getByRole('button', { name: 'Pause' }).click();
  await expect(tabA.getByText('Paused. Finished segments are saved; resume any time.')).toBeVisible();
  await expect(firstRowB.getByRole('button', { name: 'Edit' })).toBeEnabled();
  await tabB.getByRole('link', { name: 'Translate', exact: true }).click();
  await expect(startB).toBeEnabled();
  await expect(tabB.getByTestId('run-busy-elsewhere')).toHaveCount(0);
});

test('an edit saved in another tab while the job translates that segment survives the job', async ({ page: tabA }) => {
  const mock = await installMockProvider(tabA, { delayMs: 2500 });
  await configureMockProvider(tabA);
  await importBook(tabA, FIXTURES.epub);
  await openFirstBook(tabA);
  const tabB = await openSecondTab(tabA);

  // Tab B opens the editor of a pending segment before tab A starts (Edit locks once the job runs).
  await tabB.getByRole('link', { name: 'Read & edit' }).click();
  const rowB = tabB.getByTestId('segment-row').first();
  const segmentId = await rowB.getAttribute('data-segment-id');
  if (!segmentId) throw new Error('segment row without id');
  await rowB.getByRole('button', { name: 'Edit' }).click();
  const editor = rowB.getByTestId('segment-editor');
  await expect(editor).toBeVisible();

  await tabA.getByTestId('start-translation').click();
  await expect(rowB.getByRole('button', { name: 'Edit' })).toBeDisabled();
  // The job's request for this segment is in flight (the mock holds it for 2.5 s): save the edit now.
  await expect.poll(() => mock.segmentRequests.some((r) => r.ids.includes(segmentId))).toBe(true);
  await editor.fill('Bản sửa từ thẻ <b>khác</b>');
  await editor.blur();
  await expect(rowB.getByTestId('segment-translation')).toHaveText('Bản sửa từ thẻ khác');

  await expect(tabA.getByTestId('run-complete')).toBeVisible({ timeout: 90_000 });
  const stored = (await persistedSegments(tabA)).find((s) => s.id === segmentId);
  expect(stored).toMatchObject({ status: 'translated', translationHtml: 'Bản sửa từ thẻ <b>khác</b>' });

  // Both tabs show the edit, and tab B picked up the job's other results without a reload.
  await expect(rowB.getByTestId('segment-translation')).toHaveText('Bản sửa từ thẻ khác');
  await expect(tabB.getByTestId('segment-row').nth(1).getByTestId('segment-translation')).toContainText('[vi]');
  await expect(rowB.getByRole('button', { name: 'Edit' })).toBeEnabled();
  await tabA.getByRole('link', { name: 'Read & edit' }).click();
  const rowA = tabA.locator(`[data-testid="segment-row"][data-segment-id="${segmentId}"]`);
  await expect(rowA.getByTestId('segment-translation')).toHaveText('Bản sửa từ thẻ khác');
  await tabA.reload();
  await expect(rowA.getByTestId('segment-translation')).toHaveText('Bản sửa từ thẻ khác');
});
