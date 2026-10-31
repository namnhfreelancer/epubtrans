import { expect, type Page, test } from '@playwright/test';
import { strFromU8 } from 'fflate';
import { configureMockProvider, expectEpubZip, FIXTURES, importBook, openFirstBook, readDownload } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';

/** Lemmas of every Word Wise entry stored in IndexedDB. */
async function storedHintLemmas(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('epubtrans');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('hints', 'readonly').objectStore('hints').getAll();
          req.onsuccess = () => {
            resolve((req.result as { lemma: string }[]).map((r) => r.lemma));
            db.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

const count = (text: string | null, pattern: RegExp) => Number((pattern.exec(text ?? '')?.[1] ?? '').replace(/[^\d]/g, ''));

test('enables Word Wise hints, generates them after an estimate, resumes after a reload and exports “original + hints”', async ({ page }) => {
  const mock = await installMockProvider(page, { delayMs: 400 });
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  // Manual prices, so the estimate shows a cost.
  await page.locator('#price-in').fill('3');
  await page.locator('#price-in').blur();
  await page.locator('#price-out').fill('15');
  await page.locator('#price-out').blur();

  await page.getByTestId('hints-enabled').check();
  await expect(page.getByTestId('hint-level-label')).toContainText('Level 3 of 5');
  await expect(page.getByTestId('hints-estimate')).toContainText(/≈ [\d,]+ input \+ [\d,]+ output tokens for [\d,]+ words · ≈ \$/);
  const pendingBefore = count(await page.getByTestId('hints-status').textContent(), /([\d,]+) still without/);
  expect(pendingBefore).toBeGreaterThan(50);
  // No request is made before the user starts the run.
  expect(mock.hintRequests).toHaveLength(0);

  await page.getByTestId('hints-generate').click();
  await expect(page.getByTestId('hints-progress')).toBeVisible();
  // While hints are generated, the translation cannot start in this tab.
  await expect(page.getByTestId('start-translation')).toBeDisabled();
  await expect.poll(async () => (await storedHintLemmas(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // Reload mid-run: the finished words are kept, the rest is still pending.
  await page.reload();
  const kept = await storedHintLemmas(page);
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(pendingBefore);
  await expect(page.getByTestId('hints-status')).toContainText(`${kept.length} words glossed`);
  const sentBefore = mock.hintRequests.length;
  await page.getByTestId('hints-generate').click();
  await expect(page.getByTestId('hints-complete')).toBeVisible({ timeout: 60_000 });
  const resent = mock.hintRequests.slice(sentBefore).flat();
  expect(resent.some((lemma) => kept.includes(lemma))).toBe(false);
  await expect(page.getByTestId('hints-status')).toContainText(`All ${pendingBefore} words at this level are glossed.`);
  expect(new Set(await storedHintLemmas(page)).size).toBe(pendingBefore);

  // Export the original text with hints (no translation was made).
  await page.getByRole('link', { name: 'Export', exact: true }).click();
  await page.locator('input[name="export-mode"][value="original"]').check();
  await expect(page.getByTestId('export-hints-summary')).toContainText(`${pendingBefore} words glossed in Vietnamese`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-epub').click()]);
  expect(download.suggestedFilename()).toMatch(/\.en\.original\.epub$/);
  const files = expectEpubZip(await readDownload(download));
  const chapters = Object.entries(files)
    .filter(([name]) => name.endsWith('.xhtml'))
    .map(([, data]) => strFromU8(data))
    .join('\n');
  expect(chapters).toMatch(/<ruby class="et-ww">[^<]+<rp> \(<\/rp><rt[^>]*>≈[^<]+<\/rt><rp>\)<\/rp><\/ruby>/);
  expect(chapters).not.toContain('[vi]');
  expect(chapters).not.toContain('class="et-tr"');

  // The inline (Kindle / EPUB 2) style is an export option and needs no new requests.
  const requests = mock.hintRequests.length;
  await page.locator('#hint-style').selectOption('inline');
  const [inline] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-epub').click()]);
  const inlineText = Object.entries(expectEpubZip(await readDownload(inline)))
    .filter(([name]) => name.endsWith('.xhtml'))
    .map(([, data]) => strFromU8(data))
    .join('\n');
  expect(inlineText).toContain('class="et-ww-i"');
  expect(inlineText).not.toContain('<ruby');
  expect(mock.hintRequests.length).toBe(requests);
});
