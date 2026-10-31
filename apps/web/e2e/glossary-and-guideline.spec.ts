import { expect, test } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, readDownload } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';

test('generation shows its phases, extends the preset with sections and fills a typed glossary', async ({ page }) => {
  const mock = await installMockProvider(page, { delayMs: 400 });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  const presetText = await page.locator('#guideline').inputValue();

  // The guideline and glossary phases overlap, so a phase label can be on screen only briefly: record every label the
  // progress line shows instead of polling for one that may already be gone.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __guidePhases: string[] }).__guidePhases = seen;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="guide-progress"]')?.textContent;
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Generate guideline & glossary' }).click();
  await expect(page.getByText('Guideline and glossary generated.')).toBeVisible();
  const phases = await page.evaluate(() => (window as unknown as { __guidePhases: string[] }).__guidePhases.join('\n'));
  expect(phases).toContain('Writing the style guideline');
  expect(phases).toMatch(/Scanning the book|Writing the style guideline|Classifying \d+\/\d+ candidates/);
  await expect(page.getByText(/2 glossary entries from \d+ candidates\./)).toBeVisible();
  expect(mock.guideRequests).toBe(1);
  expect(mock.glossaryRequests).toBeGreaterThan(0);

  // The preset stays on top; the generated block follows with every fixed section.
  const guideline = await page.locator('#guideline').inputValue();
  expect(guideline.startsWith(presetText)).toBe(true);
  expect(guideline).toContain('### Forms of address & pronouns\n- Mock: narrator to reader: tôi – quý vị.');
  expect(guideline).toContain('### Keep untranslated');
  const sections = page.getByRole('navigation', { name: 'Guideline sections' });
  await expect(sections.getByRole('button', { name: 'Names policy' })).toBeVisible();

  // Typed rows, sorted by type then frequency.
  await expect(page.getByTestId('glossary-count')).toHaveText('2 entries');
  const first = page.getByTestId('glossary-row').first();
  await expect(first.getByLabel('Term', { exact: true })).toHaveValue('Ireland');
  await expect(first.getByLabel('Type', { exact: true })).toHaveValue('place');

  // Applying another preset replaces only the base guideline.
  await page.locator('#guideline-preset').selectOption('fiction');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Use preset' }).click();
  await expect(page.locator('#guideline')).toHaveValue(/Prioritize a natural, immersive reading experience[\s\S]*## Book-specific guideline/);
});

test('glossary table handles hundreds of entries: search, type filter, paging, edits persist', async ({ page }) => {
  await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.fb2);

  // Replace the book by its project file carrying a 320-entry glossary.
  const card = page.getByTestId('book-card');
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Export project' }).click()]);
  const files = unzipSync(await readDownload(download));
  const state = JSON.parse(strFromU8(files['project.json'] ?? new Uint8Array())) as { settings: { glossary: unknown[] } };
  const types = ['person', 'place', 'organization', 'term', 'other'];
  state.settings.glossary = Array.from({ length: 320 }, (_, i) => ({ term: `Term ${i}`, translation: `Thuật ngữ ${i}`, type: types[i % 5], count: 400 - i }));
  files['project.json'] = strToU8(JSON.stringify(state));
  page.once('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  await page.getByTestId('book-file-input').setInputFiles({ name: 'big.epubtrans', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) });
  await expect(card).toHaveCount(1);
  await openFirstBook(page);

  const rows = page.getByTestId('glossary-row');
  await expect(page.getByTestId('glossary-count')).toHaveText('320 entries');
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId('glossary-page')).toHaveText('Page 1 of 7');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows.first().getByLabel('Term', { exact: true })).toHaveValue('Term 50');

  // Search is case- and diacritics-insensitive over translations too.
  await page.getByLabel('Search terms, translations and notes').fill('THUAT NGU 31');
  await expect(page.getByTestId('glossary-count')).toHaveText('11 of 320 entries'); // 31, 310–319
  await page.getByLabel('Search terms, translations and notes').fill('');
  await page.getByLabel('Filter by type').selectOption('place');
  await expect(page.getByTestId('glossary-count')).toHaveText('64 of 320 entries');
  await expect(rows.first().getByLabel('Term', { exact: true })).toHaveValue('Term 1');

  // Edit and delete on a filtered page target the right entries and persist.
  await rows.first().getByLabel('Translation', { exact: true }).fill('Địa danh một');
  await rows.nth(1).getByRole('button', { name: 'Remove term' }).click(); // Term 6
  await expect(page.getByTestId('glossary-count')).toHaveText('63 of 319 entries');
  await page.reload();
  await expect(page.getByTestId('glossary-count')).toHaveText('319 entries');
  await page.getByLabel('Search terms, translations and notes').fill('dia danh mot');
  await expect(page.getByTestId('glossary-count')).toHaveText('1 of 319 entries');
  await expect(rows.first().getByLabel('Term', { exact: true })).toHaveValue('Term 1');
  await page.getByLabel('Search terms, translations and notes').fill('term 6');
  await expect(page.getByTestId('glossary-count')).toHaveText('10 of 319 entries'); // Term 60–69; Term 6 was removed
});
