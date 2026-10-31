import { expect, type Page, test } from '@playwright/test';
import { configureMockProvider, FIXTURES, importBook, openFirstBook, storedSettings } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';

// Pages of one browser context share the origin, hence IndexedDB, Web Locks and BroadcastChannel: two tabs.

/** The stored Word Wise hints: the language pair recorded on the book and the lemmas of every entry. */
async function storedHints(page: Page): Promise<{ glossLang?: string; lemmas: string[] }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('epubtrans');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['projects', 'hints'], 'readonly');
          const projects = tx.objectStore('projects').getAll();
          const hints = tx.objectStore('hints').getAll();
          tx.oncomplete = () => {
            const row = (projects.result as { hintLanguages?: { glossLang: string } }[])[0];
            resolve({ glossLang: row?.hintLanguages?.glossLang, lemmas: (hints.result as { lemma: string }[]).map((h) => h.lemma) });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test('a target change in another tab stops a hints run: no gloss is stored or requested for the old language afterwards', async ({ page: tabA }) => {
  const mockA = await installMockProvider(tabA, { delayMs: 500 });
  await configureMockProvider(tabA, 'sk-test-mock', { remember: true });
  await importBook(tabA, FIXTURES.epub);
  await openFirstBook(tabA);
  await tabA.getByTestId('hints-enabled').check();
  await expect(tabA.getByTestId('hints-estimate')).toBeVisible();
  await tabA.getByTestId('hints-generate').click();
  await expect(tabA.getByTestId('hints-progress')).toBeVisible();
  await expect.poll(async () => (await storedHints(tabA)).lemmas.length, { timeout: 30_000 }).toBeGreaterThan(0);

  // Tab B changes the target language vi → de while tab A's run goes on (no translations yet, so no dialog).
  const tabB = await tabA.context().newPage();
  await installMockProvider(tabB);
  await tabB.goto(tabA.url());
  await expect(tabB.getByTestId('book-title')).toBeVisible();
  await tabB.locator('#target-lang').fill('de');
  await tabB.locator('#target-lang').press('Enter');
  await expect.poll(async () => (await storedSettings(tabB)).targetLang).toBe('de');
  // Whatever is stored now was stored before the change: from here on, every gloss for Vietnamese is refused.
  const storedAtChange = await storedHints(tabB);

  // Tab A hears about it, stops sending and says why.
  await expect(tabA.locator('#target-lang')).toHaveValue('de');
  const sentAtNotice = mockA.hintRequests.length;
  await expect(tabA.getByTestId('hints-settings-changed')).toBeVisible({ timeout: 15_000 });
  await expect(tabA.getByTestId('hints-settings-changed')).toContainText('Glosses for the old language were not saved');
  // Answers that were still on their way are discarded, and no request follows (three answer delays later).
  await tabA.waitForTimeout(1500);
  expect(mockA.hintRequests.length).toBe(sentAtNotice);
  const storedAfter = await storedHints(tabA);
  expect(storedAfter).toEqual({ glossLang: 'vi', lemmas: expect.arrayContaining(storedAtChange.lemmas) });
  expect(storedAfter.lemmas).toHaveLength(storedAtChange.lemmas.length);

  // Generating again glosses in German only, replacing the Vietnamese glosses.
  const sentBefore = mockA.hintLanguages.length;
  await tabA.getByTestId('hints-generate').click();
  await expect(tabA.getByTestId('hints-complete')).toBeVisible({ timeout: 60_000 });
  expect(new Set(mockA.hintLanguages.slice(sentBefore))).toEqual(new Set(['de']));
  expect((await storedHints(tabA)).glossLang).toBe('de');
});
