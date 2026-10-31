import { expect, type Page, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, persistedSegments, storedSettings, translateAll } from './support/app-helpers';
import { installMockProvider, type MockProviderState } from './support/mock-provider';

// Pages of one browser context share the origin, hence IndexedDB, Web Locks and BroadcastChannel: two tabs. Each tab
// answers with the target language tag of its requests ("[de] ..."), so the stored text shows which language was used.

const SETTINGS_CHANGED =
  'The target language of this book changed (possibly in another tab), so this result was discarded. Start again to use the new settings.';

/** Opens the book shown in `tabA` in a second tab of the same browser context, with its own mock provider. */
async function openSecondTab(tabA: Page, delayMs = 0): Promise<{ tabB: Page; mockB: MockProviderState }> {
  const tabB = await tabA.context().newPage();
  const mockB = await installMockProvider(tabB, { prefixByTarget: true, delayMs });
  await tabB.goto(tabA.url());
  await expect(tabB.getByTestId('book-title')).toBeVisible();
  return { tabB, mockB };
}

/** A translated book open in tab A (key remembered, so tab B can translate too). */
async function translatedBookInTabA(tabA: Page): Promise<void> {
  await installMockProvider(tabA, { prefixByTarget: true });
  await configureMockProvider(tabA, 'sk-test-mock', { remember: true });
  await importBook(tabA, FIXTURES.fb2);
  await openFirstBook(tabA);
  await translateAll(tabA);
}

async function resetTargetTo(tab: Page, lang: string): Promise<void> {
  const target = tab.locator('#target-lang');
  await target.fill(lang);
  await target.press('Enter');
  await tab.getByTestId('target-change-dialog-reset').click();
  await expect(target).toHaveValue(lang);
}

const languagesIn = (rows: { translationHtml?: string }[]) => new Set(rows.map((r) => /\[([\w-]+)\]/.exec(r.translationHtml ?? '')?.[1]));

test('a target reset in one tab reaches the other: it shows the new language and never translates into the old one', async ({ page: tabA }) => {
  await translatedBookInTabA(tabA);
  const { tabB } = await openSecondTab(tabA);
  const targetB = tabB.locator('#target-lang');
  await expect(targetB).toHaveValue('vi');

  await resetTargetTo(tabA, 'de');
  // Tab B follows without a reload: German, nothing translated.
  await expect(targetB).toHaveValue('de');
  await expect(tabB.getByTestId('run-progress')).toHaveText(/^0 \//);

  await translateAll(tabB);
  const rows = await persistedSegments(tabB);
  expect(rows.length).toBeGreaterThan(0);
  expect(languagesIn(rows)).toEqual(new Set(['de']));
  expect((await storedSettings(tabB)).targetLang).toBe('de');
  // Tab A still shows German and picked up tab B's translations.
  await expect(tabA.locator('#target-lang')).toHaveValue('de');
  await expect(tabA.getByTestId('run-complete')).toBeVisible();
});

test('a tab that never heard about the new target language still translates into the stored one', async ({ page: tabA }) => {
  await installMockProvider(tabA, { prefixByTarget: true });
  await configureMockProvider(tabA, 'sk-test-mock', { remember: true });
  await importBook(tabA, FIXTURES.fb2);
  await openFirstBook(tabA);
  const { tabB } = await openSecondTab(tabA);
  // Change the stored target behind both tabs' backs (no broadcast).
  await tabB.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('epubtrans');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('projects', 'readwrite');
          const projects = tx.objectStore('projects');
          const all = projects.getAll();
          all.onsuccess = () => {
            const row = all.result[0] as { settings: Record<string, unknown> };
            projects.put({ ...row, settings: { ...row.settings, targetLang: 'fr' } });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await expect(tabB.locator('#target-lang')).toHaveValue('vi');

  await tabB.getByTestId('start-translation').click();
  // The run re-read the settings from storage: the field follows, and every translation is French.
  await expect(tabB.locator('#target-lang')).toHaveValue('fr');
  await expect(tabB.getByTestId('run-complete')).toBeVisible({ timeout: 90_000 });
  const rows = await persistedSegments(tabB);
  expect(languagesIn(rows)).toEqual(new Set(['fr']));
  expect((await storedSettings(tabB)).targetLang).toBe('fr');
});

test('a retranslation in flight while another tab resets the target language is discarded', async ({ page: tabA }) => {
  await translatedBookInTabA(tabA);
  const { tabB, mockB } = await openSecondTab(tabA, 3000);
  await tabB.getByRole('link', { name: 'Read & edit' }).click();
  const rowB = tabB.getByTestId('segment-row').first();
  await rowB.getByRole('button', { name: 'Retranslate' }).click();
  await expect.poll(() => mockB.segmentRequests.length).toBe(1);

  // Tab A resets the book to German while tab B's Vietnamese answer is on its way.
  await resetTargetTo(tabA, 'de');
  await expect(rowB.getByText(SETTINGS_CHANGED)).toBeVisible({ timeout: 15_000 });
  expect(await persistedSegments(tabA)).toEqual([]);
  expect((await storedSettings(tabA)).targetLang).toBe('de');
  await expect(rowB.getByTestId('segment-translation')).not.toContainText('[');
});
