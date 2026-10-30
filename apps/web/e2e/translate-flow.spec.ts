import { expect, test } from '@playwright/test';
import { strFromU8 } from 'fflate';
import { configureMockProvider, expectEpubZip, FIXTURES, importBook, openFirstBook, readDownload, totalSegments, translateAll } from './support/app-helpers';
import { installMockProvider, MOCK_GUIDE, translatedIds } from './support/mock-provider';

test('configures the provider, estimates cost, generates a guide, translates, edits, retranslates and exports', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
  });
  const mock = await installMockProvider(page);
  await configureMockProvider(page);
  await importBook(page, FIXTURES.epub);
  await openFirstBook(page);

  // Provider summary and estimate before translating.
  await expect(page.getByTestId('provider-summary')).toContainText('mock-model');
  const estimate = page.getByTestId('cost-estimate');
  await expect(estimate).toContainText(/≈ [\d,]+ input \+ [\d,]+ output tokens/);
  await expect(estimate).toContainText('Enter prices to see the cost.');
  await page.locator('#price-in').fill('3');
  await page.locator('#price-in').blur();
  await page.locator('#price-out').fill('15');
  await page.locator('#price-out').blur();
  await expect(estimate).toContainText(/≈ \$\d+\.\d{2,4}/);

  // Language pair: target is a searchable list with free-text BCP 47.
  await page.locator('#target-lang').fill('pt-br');
  await page.locator('#target-lang').blur();
  await expect(page.locator('#target-lang')).toHaveValue('pt-BR');
  await page.locator('#target-lang').fill('vi');
  await expect(page.locator('#source-lang')).toHaveValue('en');

  // Guideline + glossary generation, then manual glossary edits.
  await page.getByRole('button', { name: 'Generate guideline & glossary' }).click();
  await expect(page.getByText('Guideline and glossary generated.')).toBeVisible();
  await expect(page.locator('#guideline')).toHaveValue(MOCK_GUIDE.guideline);
  await expect(page.getByTestId('glossary-row')).toHaveCount(2);
  await expect(page.getByTestId('glossary-row').first().getByLabel('Translation', { exact: true })).toHaveValue('Ai-len');
  expect(mock.guideRequests).toBe(1);
  await page.getByRole('button', { name: 'Add term' }).click();
  await page.getByTestId('glossary-row').nth(2).getByLabel('Term', { exact: true }).fill('Yahoo');
  await page.getByTestId('glossary-row').nth(2).getByLabel('Translation', { exact: true }).fill('Yahoo');
  await page.getByTestId('glossary-row').nth(1).getByRole('button', { name: 'Remove term' }).click();
  await expect(page.getByTestId('glossary-row')).toHaveCount(2);

  // Full translation.
  const total = await totalSegments(page);
  expect(total).toBeGreaterThan(50);
  await translateAll(page);
  await expect(page.getByTestId('run-progress')).toHaveText(`${total} / ${total} segments`);
  expect(new Set(translatedIds(mock)).size).toBe(total);
  await expect(estimate).toContainText('Nothing left to translate.');

  // Settings and glossary survive a reload.
  await page.reload();
  await expect(page.getByTestId('glossary-row').nth(1).getByLabel('Term', { exact: true })).toHaveValue('Yahoo');
  await expect(page.locator('#price-in')).toHaveValue('3');

  // Reader: edit one segment inline, retranslate another.
  await page.getByRole('link', { name: 'Read & edit' }).click();
  const rows = page.getByTestId('segment-row');
  await expect(rows.first().getByTestId('segment-translation')).toContainText('[vi]');
  await rows.nth(1).getByRole('button', { name: 'Edit' }).click();
  const editor = rows.nth(1).getByTestId('segment-editor');
  await editor.fill('Bản dịch đã <b>chỉnh sửa</b>');
  await editor.blur();
  await expect(rows.nth(1).getByTestId('segment-translation')).toHaveText('Bản dịch đã chỉnh sửa');

  mock.prefix = '[vi-again] ';
  const before = mock.segmentRequests.length;
  await rows.nth(2).getByRole('button', { name: 'Retranslate' }).click();
  await expect(rows.nth(2).getByTestId('segment-translation')).toContainText('[vi-again]');
  expect(mock.segmentRequests.slice(before).map((r) => r.ids.length)).toEqual([1]);

  await page.reload();
  await expect(rows.nth(1).getByTestId('segment-translation')).toHaveText('Bản dịch đã chỉnh sửa');
  await expect(rows.nth(2).getByTestId('segment-translation')).toContainText('[vi-again]');

  // Export in all three layouts.
  await page.getByRole('link', { name: 'Export' }).click();
  for (const [label, check] of [
    ['Bilingual, source first', 'et-src'],
    ['Bilingual, translation first', 'et-tr'],
    ['Translation only', '[vi]'],
  ] as const) {
    await page.getByLabel(label).check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-epub').click()]);
    expect(download.suggestedFilename()).toMatch(/\.epub$/);
    const files = expectEpubZip(await readDownload(download));
    const xhtml = Object.entries(files)
      .filter(([name]) => name.endsWith('.xhtml') || name.endsWith('.html'))
      .map(([, bytes]) => strFromU8(bytes))
      .join('\n');
    expect(xhtml).toContain(check);
    expect(xhtml).toContain('chỉnh sửa');
  }
  expect(cspViolations).toEqual([]);
});
