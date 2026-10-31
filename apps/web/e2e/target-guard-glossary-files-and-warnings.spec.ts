import { expect, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, persistedSegments, readDownload, translateAll } from './support/app-helpers';
import { installMockProvider, MOCK_BASE } from './support/mock-provider';

test('changing the target language of a translated book asks first: cancel, keep, or reset to pending', async ({ page }) => {
  await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.fb2);
  await openFirstBook(page);
  await translateAll(page);
  const target = page.locator('#target-lang');
  const dialog = page.getByTestId('target-change-dialog');

  // Cancel: nothing changes and the field shows the saved language again.
  await target.fill('fr');
  await target.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/segments are already translated into Vietnamese/);
  await page.getByTestId('target-change-dialog-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(target).toHaveValue('vi');

  // Keep: the language changes, the translations stay.
  await target.fill('fr');
  await target.blur();
  await page.getByTestId('target-change-dialog-keep').click();
  await expect(target).toHaveValue('fr');
  await expect(page.getByTestId('run-complete')).toBeVisible();

  // Reset: every segment is pending again, in memory and in storage.
  await target.fill('de');
  await target.press('Enter');
  await page.getByTestId('target-change-dialog-reset').click();
  await expect(page.getByText(/segments were reset to pending/)).toBeVisible();
  await expect(target).toHaveValue('de');
  await expect(page.getByTestId('run-progress')).toHaveText(/^0 \//);
  expect(await persistedSegments(page)).toEqual([]);
});

test('glossary files: import CSV, merge or replace a second file, export CSV and JSON', async ({ page }) => {
  await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.fb2);
  await openFirstBook(page);
  const input = page.getByTestId('glossary-file-input');

  await input.setInputFiles({
    name: 'names.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('term,translation,type,note\nFox,Cáo,other,animal\nfox,dup\nGrapes,Nho,term,\n'),
  });
  await expect(page.getByTestId('glossary-count')).toHaveText('2 entries');
  await expect(page.getByText('Glossary imported: 2 entries added, 1 skipped')).toBeVisible();

  // A second file asks: merge keeps the existing entry for "Fox" and adds "Wolf".
  const second = {
    name: 'more.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        { term: 'fox', translation: 'Con cáo' },
        { term: 'Wolf', translation: 'Sói' },
      ]),
    ),
  };
  await input.setInputFiles(second);
  await page.getByTestId('glossary-import-dialog-merge').click();
  await expect(page.getByTestId('glossary-count')).toHaveText('3 entries');
  await expect(page.getByTestId('glossary-row').first().getByLabel('Translation', { exact: true })).toHaveValue('Cáo');

  // Export CSV, then replace the glossary with the JSON file.
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('glossary-export-csv').click()]);
  expect(csv.suggestedFilename()).toMatch(/\.glossary\.csv$/);
  expect(new TextDecoder().decode(await readDownload(csv))).toBe('term,translation,type,note\r\nFox,Cáo,other,animal\r\nGrapes,Nho,term,\r\nWolf,Sói,,\r\n');
  await input.setInputFiles(second);
  await page.getByTestId('glossary-import-dialog-replace').click();
  await expect(page.getByTestId('glossary-count')).toHaveText('2 entries');

  // Invalid files are refused with the line number.
  await input.setInputFiles({ name: 'bad.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from('Fox\tCáo\nWolf\t\n') });
  await expect(page.getByText(/line 2: the translation of "Wolf" is empty/)).toBeVisible();
  await expect(page.getByTestId('glossary-count')).toHaveText('2 entries');
});

test('translations identical to the source are flagged as warnings, counted and filtered apart from errors', async ({ page }) => {
  // An empty prefix makes the mock answer every segment with its source: an untranslated echo.
  await installMockProvider(page, { prefix: '' });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await translateAll(page);
  await page.getByRole('link', { name: 'Read & edit' }).click();

  const controls = page.getByTestId('warning-controls');
  await expect(controls).toBeVisible();
  await expect(page.getByTestId('warning-count')).toHaveText(/^\d+ warnings$/);
  await expect(page.getByTestId('only-errors')).toHaveCount(0);
  await page.getByTestId('next-warning').click();
  await expect(page.getByTestId('warning-count')).toHaveText(/^Warning 1 of \d+$/);
  await page.getByTestId('only-warnings').check();
  const rows = page.getByTestId('segment-row');
  await expect(rows.first().getByTestId('segment-warning')).toHaveText('Same as source');
  const shown = await rows.count();
  expect(await rows.getByTestId('segment-warning').count()).toBe(shown);
  // Warnings are translated segments: export would use them as they are.
  await expect(rows.first().getByTestId('segment-status')).toHaveText('Translated');
});

test('the reasoning setting is sent to the provider and the cached input price is configurable', async ({ page }) => {
  await installMockProvider(page);
  await configureMockProvider(page);
  await page.locator('#reasoning').selectOption('low');
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${MOCK_BASE}/chat/completions`) && request.method() === 'POST') bodies.push(request.postData() ?? '');
  });
  await importBook(page, FIXTURES.fb2);
  await openFirstBook(page);
  await page.locator('#cached-price').fill('25');
  await page.locator('#cached-price').blur();
  await translateAll(page);
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.every((b) => (JSON.parse(b) as { reasoning_effort?: string }).reasoning_effort === 'low')).toBe(true);
  await page.reload();
  await expect(page.locator('#cached-price')).toHaveValue('25');
  await page.goto('/#/settings');
  await expect(page.locator('#reasoning')).toHaveValue('low');
});
