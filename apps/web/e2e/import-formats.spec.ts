import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { FIXTURES, importBook, openFirstBook } from './support/app-helpers';

const BOOKS = [
  { format: 'EPUB', file: FIXTURES.epub, title: /Modest Proposal/i },
  { format: 'MOBI', file: FIXTURES.mobi, title: /Modest Proposal/i },
  { format: 'AZW3', file: FIXTURES.azw3, title: /Modest Proposal/i },
  { format: 'FB2', file: FIXTURES.fb2, title: /Aesop/i },
  { format: 'TXT', file: FIXTURES.txt, title: /Three Fables of Aesop/ },
  { format: 'Markdown', file: FIXTURES.md, title: /Three Fables of Aesop/ },
];

for (const book of BOOKS) {
  test(`imports a DRM-free ${book.format} book and shows its segments`, async ({ page }) => {
    await importBook(page, book.file);
    const card = page.getByTestId('book-card').first();
    await expect(card).toContainText(book.title);
    await expect(card.getByTestId('book-progress')).toHaveText(/^0 \/ [1-9][\d,]* segments$/);

    await openFirstBook(page);
    await expect(page.getByTestId('book-title')).toHaveText(book.title);
    await page.getByRole('link', { name: 'Read & edit' }).click();
    await expect(page.getByTestId('segment-row').first()).toBeVisible();
    await expect(page.getByTestId('segment-status').first()).toHaveText('Pending');
  });
}

test('shows a friendly error for unsupported files', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('book-file-input').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 not a book') });
  await expect(page.getByTestId('import-error')).toContainText('Unsupported file');
  await expect(page.getByTestId('book-card')).toHaveCount(0);
});

test('refuses DRM-protected books with a clear message', async ({ page }) => {
  const files = unzipSync(new Uint8Array(readFileSync(FIXTURES.epub)));
  files['META-INF/rights.xml'] = strToU8('<rights/>');
  const { mimetype, ...rest } = files;
  const drm = zipSync({ mimetype: [mimetype ?? strToU8('application/epub+zip'), { level: 0 }], ...rest });
  await page.goto('/#/');
  await page.getByTestId('book-file-input').setInputFiles({ name: 'locked.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(drm) });
  await expect(page.getByTestId('import-error')).toContainText('DRM-protected');
  await expect(page.getByTestId('book-card')).toHaveCount(0);
});
