import { expect, test } from '@playwright/test';
import { strFromU8 } from 'fflate';
import { configureMockProvider, expectEpubZip, FIXTURES, importBook, openFirstBook, readDownload, translateAll } from './support/app-helpers';
import { installMockProvider } from './support/mock-provider';
import { evalInSection, sectionFrame } from './support/preview-frames';

const css = (files: Record<string, Uint8Array>) => strFromU8(files[Object.keys(files).find((k) => k.endsWith('epubtrans.css')) ?? ''] ?? new Uint8Array());

test('book style: live preview, embedded fonts and attribution in the export, templates applied to another book', async ({ page }) => {
  await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);
  await translateAll(page);

  // The preview shows the default look, then follows style changes made next to it.
  await page.getByRole('link', { name: 'Preview' }).click();
  await sectionFrame(page, 'body');
  await page.getByTestId('preview-toc-item').nth(1).click();
  await sectionFrame(page, '.et-tr');
  await expect.poll(() => evalInSection(page, 'p.et-src', (el) => getComputedStyle(el).opacity)).toBe('0.55');

  const style = page.getByTestId('preview-style');
  await style.locator('summary').click();
  await style.getByTestId('style-preset').selectOption('minimal');
  await expect.poll(() => evalInSection(page, 'p.et-src', (el) => getComputedStyle(el).opacity), { timeout: 30_000 }).toBe('1');
  await style.getByTestId('style-translation-color-custom').check();
  await style.getByTestId('style-translation-color').fill('#aa2200');
  await expect.poll(() => evalInSection(page, 'p.et-tr', (el) => getComputedStyle(el).color), { timeout: 30_000 }).toBe('rgb(170, 34, 0)');
  await expect(style.getByTestId('style-preset')).toHaveValue('custom');
  // An embedded font: loaded lazily from this origin and packaged into the preview build.
  const fontRequest = page.waitForRequest((r) => r.url().includes('literata-regular') && r.url().startsWith(new URL(page.url()).origin));
  await style.getByTestId('style-translation-font').selectOption('literata');
  await fontRequest;
  await expect.poll(() => evalInSection(page, 'p.et-tr', (el) => getComputedStyle(el).fontFamily), { timeout: 30_000 }).toContain('Literata');
  await expect(style.getByTestId('style-fonts-size')).toContainText('KB');

  // The export carries the style, the font files with their license, and the opt-in attribution page.
  await page.getByRole('link', { name: 'Export' }).click();
  const editor = page.getByTestId('export-style-editor');
  await expect(editor.getByTestId('style-translation-color')).toHaveValue('#aa2200');
  await expect(editor.getByTestId('style-fonts-size')).toContainText('293 KB');
  await editor.getByTestId('style-attribution').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-epub').click()]);
  const files = expectEpubZip(await readDownload(download));
  expect(css(files)).toContain('.et-tr { color: #aa2200 !important; font-family: "Literata", serif !important; }');
  expect(files['OEBPS/epubtrans-fonts/literata-regular.ttf']?.byteLength).toBe(95_372);
  expect(strFromU8(files['OEBPS/epubtrans-fonts/literata-OFL.txt'] ?? new Uint8Array())).toContain('SIL OPEN FONT LICENSE');
  expect(strFromU8(files['OEBPS/epubtrans-attribution.xhtml'] ?? new Uint8Array())).toContain('mock-model');
  const opf = strFromU8(files['OEBPS/content.opf'] ?? new Uint8Array());
  expect(opf).toContain('unique-identifier="epubtrans-uid"');
  expect(opf).toContain('media-type="font/ttf"');

  // Save the style as a template, then apply it to another book.
  const templates = page.getByTestId('style-templates');
  await templates.getByTestId('template-name').fill('Warm serif');
  await templates.getByTestId('template-save').click();
  await expect(templates.getByTestId('template-item')).toHaveCount(1);
  await expect(templates.getByTestId('template-item')).toContainText('Warm serif');
  page.once('dialog', (dialog) => void dialog.accept('Warm serif 2'));
  await templates.getByTestId('template-rename').click();
  await expect(templates.getByTestId('template-item')).toContainText('Warm serif 2');

  await importBook(page, FIXTURES.fb2);
  await page.getByTestId('book-card').filter({ hasText: 'Three Fables of Aesop' }).getByRole('link', { name: 'Open' }).click();
  await expect(page.getByTestId('book-title')).toContainText('Three Fables of Aesop');
  await page.getByRole('link', { name: 'Export' }).click();
  const other = page.getByTestId('export-style-editor');
  await expect(other.getByTestId('style-preset')).toHaveValue('classic');
  await page.getByTestId('style-templates').getByTestId('template-apply').click();
  await expect(other.getByTestId('style-translation-color')).toHaveValue('#aa2200');
  await expect(other.getByTestId('style-translation-font')).toHaveValue('literata');
  await expect(other.getByTestId('style-attribution')).not.toBeChecked();

  // Templates leave as a validated JSON file.
  const [templateFile] = await Promise.all([page.waitForEvent('download'), page.getByTestId('template-export-all').click()]);
  const exported = JSON.parse(strFromU8(await readDownload(templateFile))) as { format: string; templates: { name: string }[] };
  expect(exported.format).toBe('epubtrans-style-templates');
  expect(exported.templates.map((t) => t.name)).toEqual(['Warm serif 2']);
});
