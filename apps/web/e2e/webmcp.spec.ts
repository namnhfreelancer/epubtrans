import { readFileSync } from 'node:fs';
import { type Dialog, expect, type Page, test } from '@playwright/test';
import { configureMockProvider, expectEpubZip, FIXTURES, readDownload } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';
import { callTool, installModelContextStub, registeredToolNames, type ToolCallLog } from './support/webmcp-stub';

const KEY = 'sk-test-WEBMCP-LEAK-4242';
const BOOK_URL = 'https://books.example.test/library/a-modest-proposal.epub';
const NO_CORS_URL = 'https://no-cors.example.test/book.epub';

/** Answers the next dialog and records its text. */
function answerNextDialog(page: Page, accept: boolean, texts: string[]): void {
  page.once('dialog', (dialog: Dialog) => {
    texts.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
}

test('an in-browser agent drives a whole translation through the WebMCP tools', async ({ page }) => {
  const log: ToolCallLog = { outputs: [] };
  const dialogs: string[] = [];
  await installModelContextStub(page);
  const mock = await installMockProvider(page);
  const epub = readFileSync(FIXTURES.epub);
  await page.route('https://books.example.test/**', (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/epub+zip' }, body: epub }),
  );
  // A host without CORS headers: fetch() rejects with a TypeError, which an aborted request reproduces
  // (Playwright's fulfilled responses skip the browser's CORS check).
  await page.route('https://no-cors.example.test/**', (route) => route.abort('failed'));
  await configureMockProvider(page, KEY);

  expect((await registeredToolNames(page)).sort()).toEqual(
    [
      'configure_provider',
      'delete_book',
      'export_epub',
      'generate_guide',
      'get_book_status',
      'import_book_from_url',
      'list_books',
      'list_errors',
      'list_models',
      'pause_translation',
      'retranslate_segment',
      'start_translation',
      'translate_sample',
      'update_book_settings',
    ].sort(),
  );

  // Import from a URL, after the user approves the host.
  answerNextDialog(page, true, dialogs);
  const imported = await callTool(page, log, 'import_book_from_url', { url: BOOK_URL });
  expect(imported).toMatchObject({ ok: true, title: expect.stringContaining('Modest Proposal') });
  expect(dialogs.at(-1)).toContain('books.example.test');
  const bookId = String(imported.bookId);
  await expect(page.getByTestId('book-title')).toBeVisible();

  answerNextDialog(page, true, dialogs);
  expect(await callTool(page, log, 'import_book_from_url', { url: NO_CORS_URL })).toMatchObject({ ok: false, error: expect.stringContaining('CORS') });

  // Configure: preset and model (the key and endpoint were set by the user in Settings).
  expect(await callTool(page, log, 'list_models', { filter: 'mock' })).toMatchObject({ ok: true, models: ['mock-model', 'mock-model-pro'] });
  expect(await callTool(page, log, 'configure_provider', { providerId: 'custom', model: 'mock-model-pro' })).toMatchObject({
    ok: true,
    model: 'mock-model-pro',
    keyPresent: true,
    ready: true,
  });
  expect(await callTool(page, log, 'update_book_settings', { bookId, targetLang: 'vi', twoPass: false })).toMatchObject({ ok: true, targetLang: 'vi' });
  await expect(page.getByTestId('provider-summary')).toContainText('mock-model-pro');

  // Guide generation shows in the guideline card, like a run started by the user.
  const guide = await callTool(page, log, 'generate_guide', { bookId, maxEntries: 30 });
  expect(guide).toMatchObject({ ok: true, glossaryEntries: expect.any(Number) });
  await expect(page.getByText('Guideline and glossary generated.')).toBeVisible();
  expect(mock.guideRequests).toBe(1);

  // Sample.
  const sample = await callTool(page, log, 'translate_sample', { bookId, passages: 1 });
  expect(sample).toMatchObject({ ok: true });
  expect((sample.preview as { translation: string }[])[0]?.translation).toContain('[vi]');
  await expect(page.getByTestId('sample-complete')).toBeVisible();
  const sampled = new Set(mock.segmentRequests.flatMap((r) => r.ids));

  // Make one untranslated segment fail during the full run.
  await page.goto(`/#/book/${encodeURIComponent(bookId)}/read`);
  const ids = await page.getByTestId('segment-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-segment-id') ?? ''));
  const failing = ids.find((id) => id && !sampled.has(id));
  expect(failing).toBeTruthy();
  mock.invalidIds.add(String(failing));

  // Start: the user sees provider, model and cost, and accepts.
  answerNextDialog(page, true, dialogs);
  const started = await callTool(page, log, 'start_translation', { bookId });
  expect(started).toMatchObject({ ok: true, started: true });
  expect(dialogs.at(-1)).toMatch(/with Custom.*, model mock-model-pro\? \d+ segments remain; estimated cost: \$\d/s);

  // Status polling until the run ends.
  await expect
    .poll(async () => ((await callTool(page, log, 'get_book_status', { bookId })).job as { status: string }).status, { timeout: 90_000 })
    .toBe('done');
  const status = await callTool(page, log, 'get_book_status', { bookId });
  expect(status).toMatchObject({ ok: true, counts: { failed: 1 }, remaining: 1 });

  // Fix the failure.
  expect(await callTool(page, log, 'list_errors', { bookId })).toMatchObject({ ok: true, total: 1, items: [{ segmentId: failing }] });
  mock.invalidIds.clear();
  expect(await callTool(page, log, 'retranslate_segment', { bookId, segmentId: String(failing) })).toMatchObject({ ok: true, status: 'translated' });
  await expect(page.locator(`[data-segment-id="${failing}"]`)).toHaveAttribute('data-status', 'translated');
  expect(await callTool(page, log, 'list_errors', { bookId })).toMatchObject({ total: 0 });

  // Export downloads the EPUB.
  const [download, exported] = await Promise.all([page.waitForEvent('download'), callTool(page, log, 'export_epub', { bookId, mode: 'bilingual' })]);
  expect(exported).toMatchObject({ ok: true, untranslated: 0 });
  expect(download.suggestedFilename()).toBe(exported.fileName);
  expectEpubZip(await readDownload(download));

  // Delete: declined first, then accepted.
  answerNextDialog(page, false, dialogs);
  expect(await callTool(page, log, 'delete_book', { bookId })).toMatchObject({ ok: true, deleted: false, reason: 'declined' });
  expect(await callTool(page, log, 'list_books')).toMatchObject({ count: 1 });
  answerNextDialog(page, true, dialogs);
  expect(await callTool(page, log, 'delete_book', { bookId })).toMatchObject({ ok: true, deleted: true });
  expect(await callTool(page, log, 'list_books')).toMatchObject({ ok: true, count: 0 });
  await expect(page.getByText('No books yet. Add one to get started.')).toBeVisible();

  // The key never reached the agent, in outputs or in the dialogs shown on its behalf.
  for (const text of [...log.outputs, ...dialogs]) expect(text).not.toContain(KEY);
});

test('a declined start sends no translation request', async ({ page }) => {
  const log: ToolCallLog = { outputs: [] };
  const dialogs: string[] = [];
  await installModelContextStub(page);
  const mock = await installMockProvider(page);
  await page.route('https://books.example.test/**', (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(FIXTURES.fb2) }),
  );
  await configureMockProvider(page, KEY);
  answerNextDialog(page, true, dialogs);
  const { bookId } = await callTool(page, log, 'import_book_from_url', { url: 'https://books.example.test/aesop-fables.fb2' });

  answerNextDialog(page, false, dialogs);
  expect(await callTool(page, log, 'start_translation', { bookId })).toMatchObject({ ok: true, started: false, reason: 'declined' });
  expect(mock.segmentRequests).toHaveLength(0);
  await expect(page.getByTestId('start-translation')).toBeEnabled();
});
