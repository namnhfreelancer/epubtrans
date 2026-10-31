import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { configureMockProvider, FIXTURES, importBook, openFirstBook } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';
import { evalInSection, sectionFrame } from './support/preview-frames';

const SEARCH_WORD = 'melancholy';
/** Chrome's report of a blocked inline script (older versions: "Refused to execute inline script ..."). */
const INLINE_SCRIPT_VIOLATION = /inline script/i;

/** Finds, in the reader, the segment whose source contains `text`. */
async function segmentIdWithText(page: Page, text: string): Promise<string> {
  const chapters = page.getByTestId('chapter-item');
  await expect(chapters.first()).toBeVisible();
  for (let i = 0; i < (await chapters.count()); i++) {
    await chapters.nth(i).click();
    await expect(chapters.nth(i)).toHaveAttribute('aria-current', 'true');
    const match = page.getByTestId('segment-row').filter({ hasText: text });
    if ((await match.count()) > 0) return (await match.first().getAttribute('data-segment-id')) ?? '';
  }
  throw new Error(`no segment contains "${text}"`);
}

test('previews the export on emulated devices, searches it and opens a clicked paragraph in the editor', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
  });
  const mock = await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);

  // One segment fails, so the preview has an error to highlight.
  await page.getByRole('link', { name: 'Read & edit' }).click();
  const failedId = await segmentIdWithText(page, `${SEARCH_WORD} object`);
  expect(failedId).not.toBe('');
  mock.invalidIds.add(failedId);
  await page.getByRole('link', { name: 'Translate' }).click();
  await page.getByTestId('start-translation').click();
  await expect(page.getByTestId('run-errors')).toBeVisible({ timeout: 90_000 });

  // The preview renders the export inside foliate's sandboxed frame.
  await page.getByRole('link', { name: 'Preview' }).click();
  await expect(page).toHaveURL(/#\/book\/[^/]+\/preview$/);
  const bookId = /#\/book\/([^/]+)\//.exec(page.url())?.[1] ?? '';
  // It opens at the start of the book (the cover); the contents list leads to the text.
  await sectionFrame(page, 'body');
  await expect(page.getByTestId('preview-toc-item')).toHaveCount(4);
  await page.getByTestId('preview-toc-item').nth(1).click();
  let frame = await sectionFrame(page, '[data-et-id]');
  await expect(frame.locator('body')).toContainText('[vi] ');
  await expect(page.getByTestId('preview-toc-item').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('preview-status')).toHaveCount(0);
  await expect(page.getByTestId('preview-progress')).toContainText('%');

  // Book scripts never run: each section carries its own script-blocking policy (on top of the app CSP).
  await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /script-src 'none'/);
  const scriptRan = (head: Element) => {
    const script = head.ownerDocument.createElement('script');
    script.textContent = 'window.__previewScriptRan = true';
    head.append(script);
    return (head.ownerDocument.defaultView as unknown as { __previewScriptRan?: boolean }).__previewScriptRan === true;
  };
  await expect.poll(() => evalInSection(page, 'head', scriptRan)).toBe(false);
  // Blocked by both the section's own policy and the inherited app policy.
  const scriptRefusals = () => cspViolations.filter((v) => INLINE_SCRIPT_VIOLATION.test(v)).join('\n');
  await expect.poll(scriptRefusals).toContain("script-src 'none'");
  await expect.poll(scriptRefusals).toContain("script-src 'self'");

  // Page turning: the button and the arrow keys move through the book.
  const progress = page.getByTestId('preview-progress');
  const start = await progress.textContent();
  await page.getByTestId('preview-next').click();
  await page.getByTestId('book-title').click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(progress).not.toHaveText(start ?? '');

  // Device, theme, display mode and font size.
  const box = page.getByTestId('preview-frame');
  await page.getByTestId('preview-device').selectOption('phone');
  await expect(box).toHaveAttribute('data-device', 'phone');
  const phone = await box.boundingBox();
  expect(phone?.width).toBeLessThanOrEqual(390 + 12);
  expect((phone?.height ?? 0) / (phone?.width ?? 1)).toBeGreaterThan(1.8);
  await page.getByTestId('preview-device').selectOption('desktop');
  await expect.poll(async () => (await box.boundingBox())?.width ?? 0).toBeGreaterThan(phone?.width ?? 0);

  await page.getByTestId('preview-theme').selectOption('dark');
  await expect.poll(() => evalInSection(page, 'body', (body) => getComputedStyle(body).backgroundColor)).toBe('rgb(18, 18, 18)');

  await page.getByTestId('preview-flow').selectOption('scrolled');
  await expect(box).toHaveAttribute('data-flow', 'scrolled');
  await expect.poll(() => evalInSection(page, 'html', (html) => (html as HTMLElement).style.getPropertyValue('column-width'))).toBe('auto');

  const fontSize = () => evalInSection(page, 'html', (html) => Number.parseFloat(getComputedStyle(html).fontSize));
  let before = 0;
  await expect.poll(async () => (before = (await fontSize()) ?? 0)).toBeGreaterThan(0);
  await page.getByTestId('preview-font-larger').click();
  await expect(page.getByTestId('preview-font-scale')).toHaveText('110%');
  await expect.poll(fontSize).toBeGreaterThan(before);

  // Export layouts come from core: translation-only drops the faded source copies.
  await page.getByTestId('preview-mode').selectOption('translation-only');
  await expect.poll(() => evalInSection(page, 'body', (body) => body.querySelectorAll('[data-et-id]').length > 0 && !body.querySelector('.et-src'))).toBe(true);
  await page.getByTestId('preview-mode').selectOption('bilingual');
  await sectionFrame(page, '.et-src');

  // Search finds the word and jumps to it.
  await page.getByTestId('preview-search-input').fill(SEARCH_WORD);
  await page.getByTestId('preview-search-submit').click();
  await expect(page.getByTestId('preview-search-status')).toHaveText(/^\d+ results?$/);
  await page.getByTestId('preview-search-result').first().click();

  // The failed segment is highlighted (outline and badge) and the highlight can be switched off.
  const failedSelector = `.et-error[data-et-id="${failedId}"]`;
  frame = await sectionFrame(page, failedSelector);
  await expect(frame.locator(failedSelector).first()).toContainText(SEARCH_WORD);
  const outline = () => evalInSection(page, failedSelector, (el) => getComputedStyle(el).outlineStyle);
  const badge = () => evalInSection(page, failedSelector, (el) => getComputedStyle(el, '::before').content);
  await expect.poll(outline).toBe('solid');
  await expect.poll(badge).toBe('"Error"');
  await page.getByTestId('preview-show-issues').uncheck();
  await expect.poll(badge).toBe('none');
  await page.getByTestId('preview-show-issues').check();
  await expect.poll(outline).toBe('solid');

  // Clicking the paragraph opens the editor on that segment.
  await expect(async () => {
    const current = await sectionFrame(page, failedSelector);
    await current.locator(failedSelector).first().click({ timeout: 2000 });
    await expect(page).toHaveURL(new RegExp(`#/book/${bookId}/read/${failedId}$`), { timeout: 2000 });
  }).toPass();
  const row = page.locator(`[data-segment-id="${failedId}"]`);
  await expect(row).toBeFocused();
  await expect(row.getByTestId('segment-status')).toHaveText('Error');

  // Preview-only settings persist for the next visit.
  await page.getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByTestId('preview-theme')).toHaveValue('dark');
  await expect(page.getByTestId('preview-font-scale')).toHaveText('110%');

  // The book's styles, fonts and frames load under the app CSP; the only refusal was the injected script.
  expect(cspViolations.filter((v) => !INLINE_SCRIPT_VIOLATION.test(v))).toEqual([]);
});

test('rebuilds after an edit made elsewhere and stays on the same page', async ({ page }) => {
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await page.getByRole('link', { name: 'Preview' }).click();
  await sectionFrame(page, 'body');
  await page.getByTestId('preview-toc-item').nth(1).click();
  let frame = await sectionFrame(page, '[data-et-id]');
  // Leave the first page of the chapter, so a rebuild that lost the position would show.
  const progress = page.getByTestId('preview-progress');
  for (let i = 0; i < 4; i++) {
    const before = (await progress.getAttribute('data-fraction')) ?? '';
    // foliate ignores a page turn that arrives while the previous one is still settling: click again then.
    await expect(async () => {
      await page.getByTestId('preview-next').click();
      await expect(progress).not.toHaveAttribute('data-fraction', before, { timeout: 1000 });
    }).toPass();
  }

  frame = await sectionFrame(page, 'p.et-pending[data-et-id]');
  const box = page.getByTestId('preview-frame');
  /** The block is on the visible page (a paginated frame lays all pages of the chapter side by side). */
  const onScreen = async (selector: string) => {
    const [outer, inner] = await Promise.all([box.boundingBox(), frame.locator(selector).first().boundingBox()]);
    return !!outer && !!inner && inner.width > 0 && inner.x >= outer.x - 1 && inner.x < outer.x + outer.width;
  };
  // Nothing is translated yet: every paragraph is flagged as pending. Pick one on the current page.
  const ids = await frame.locator('p.et-pending[data-et-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-et-id') ?? ''));
  let segmentId = '';
  for (const id of ids) {
    if (await onScreen(`[data-et-id="${id}"]`)) {
      segmentId = id;
      break;
    }
  }
  expect(segmentId).not.toBe('');
  expect(ids.indexOf(segmentId)).toBeGreaterThan(2);

  // Another tab edits that segment; the broadcast refresh rebuilds the preview here.
  const editor = await page.context().newPage();
  await editor.goto(page.url().replace(/\/preview$/, `/read/${segmentId}`));
  const row = editor.locator(`[data-segment-id="${segmentId}"]`);
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByTestId('segment-editor').fill('Bản xem trước đã cập nhật');
  await row.getByTestId('segment-editor').blur();
  await expect(row.getByTestId('segment-translation')).toHaveText('Bản xem trước đã cập nhật');

  const translated = `.et-tr[data-et-id="${segmentId}"]`;
  frame = await sectionFrame(page, translated);
  await expect(frame.locator(translated)).toHaveText('Bản xem trước đã cập nhật');
  await expect(frame.locator(`.et-pending[data-et-id="${segmentId}"]`)).toHaveCount(0);
  await expect.poll(() => onScreen(`.et-src[data-et-id="${segmentId}"]`)).toBe(true);
});

const EVIL_HOST = 'evil.example';
const EXTERNAL_LINK = 'a[href^="https://www.gutenberg.org"]';

/** The fixture book with a meta refresh and network-hint links added to every content document's head. */
function bookWithNetworkHints(): { name: string; mimeType: string; buffer: Buffer } {
  const files = unzipSync(new Uint8Array(readFileSync(FIXTURES.epub)));
  const hints =
    `<meta http-equiv="refresh" content="0;url=https://${EVIL_HOST}/refresh"/>` +
    `<link rel="prefetch" href="https://${EVIL_HOST}/prefetch"/><link rel="preconnect" href="https://${EVIL_HOST}"/>` +
    `<link rel="dns-prefetch" href="https://${EVIL_HOST}"/><link rel="preload" as="image" href="https://${EVIL_HOST}/preload.png"/>`;
  const out: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [name, data] of Object.entries(files)) {
    if (name === 'mimetype') out[name] = [data, { level: 0 }];
    else out[name] = /\.x?html?$/i.test(name) && name.includes('1080-h') ? strToU8(strFromU8(data).replace('</head>', `${hints}</head>`)) : data;
  }
  return { name: 'hinted.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(zipSync(out)) };
}

test('opens external links without a window.opener and keeps meta refresh and network hints out of the preview', async ({ page, context }) => {
  const evilRequests: string[] = [];
  await context.route(`**://${EVIL_HOST}/**`, (route) => {
    evilRequests.push(route.request().url());
    return route.abort();
  });
  await context.route('https://www.gutenberg.org/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>external</title><p>external site</p>' }),
  );

  await page.goto('/#/');
  await page.getByTestId('book-file-input').setInputFiles(bookWithNetworkHints());
  await expect(page.getByTestId('book-card')).toHaveCount(1, { timeout: 60_000 });
  await openFirstBook(page);
  await page.getByRole('link', { name: 'Preview' }).click();
  await sectionFrame(page, 'body');
  await page.getByTestId('preview-toc-item').nth(1).click();
  const frame = await sectionFrame(page, EXTERNAL_LINK);

  // The section rendered (a surviving refresh would have turned the frame into an error page) and holds no hints.
  await expect(frame.locator('[data-et-id]').first()).toBeAttached();
  await expect(
    frame.locator('meta[http-equiv="refresh" i], link[rel~="prefetch"], link[rel~="preconnect"], link[rel~="dns-prefetch"], link[rel~="preload"]'),
  ).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(evilRequests).toEqual([]);

  // Clicking the link opens a new tab that cannot reach the app tab; the app tab stays where it was.
  const appUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await frame.locator(EXTERNAL_LINK).first().click();
  const popup = await popupPromise;
  await popup.waitForURL('https://www.gutenberg.org/');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(page.url()).toBe(appUrl);
  await popup.close();
});
