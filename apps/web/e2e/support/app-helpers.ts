import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Download, expect, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { MOCK_BASE } from './mock-provider';

export const FIXTURES = {
  epub: fixturePath('a-modest-proposal.epub'),
  mobi: fixturePath('a-modest-proposal.mobi'),
  azw3: fixturePath('a-modest-proposal.azw3'),
  fb2: fixturePath('aesop-fables.fb2'),
} as const;

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../../packages/core/test/fixtures/${name}`, import.meta.url));
}

/** Configures the Custom preset to point at the mock provider, tests the connection and picks a model. */
export async function configureMockProvider(page: Page, apiKey = 'sk-test-mock', opts: { remember?: boolean } = {}): Promise<void> {
  await page.goto('/#/settings');
  await page.locator('#provider').selectOption('custom');
  await page.locator('#base-url').fill(MOCK_BASE);
  await page.locator('#api-key').fill(apiKey);
  if (opts.remember) await page.getByLabel('Remember key on this device').check();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByTestId('connection-status')).toContainText('2 models');
  await page.locator('#model-select').selectOption('mock-model');
  await expect(page.locator('#model-id')).toHaveValue('mock-model');
}

/** Imports a book from the library page and waits for its card. */
export async function importBook(page: Page, file: string): Promise<void> {
  await page.goto('/#/');
  const before = await page.getByTestId('book-card').count();
  await page.getByTestId('book-file-input').setInputFiles(file);
  await expect(page.getByTestId('book-card')).toHaveCount(before + 1, { timeout: 60_000 });
}

/** Opens the first (most recent) book card. */
export async function openFirstBook(page: Page): Promise<void> {
  await page.getByTestId('book-card').first().getByRole('link', { name: 'Open' }).click();
  await expect(page.getByTestId('book-title')).toBeVisible();
}

export async function totalSegments(page: Page): Promise<number> {
  const text = (await page.getByTestId('run-progress').textContent()) ?? '';
  const match = /\/\s*([\d,.\s]+)/.exec(text);
  return Number((match?.[1] ?? '0').replace(/[^\d]/g, ''));
}

export async function translateAll(page: Page): Promise<void> {
  await page.getByTestId('start-translation').click();
  await expect(page.getByTestId('run-complete')).toBeVisible({ timeout: 90_000 });
}

export async function readDownload(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  return new Uint8Array(readFileSync(path));
}

/** An EPUB (OCF) zip must start with an uncompressed `mimetype` entry. */
export function expectEpubZip(bytes: Uint8Array): Record<string, Uint8Array> {
  expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');
  expect(String.fromCharCode(...bytes.subarray(30, 38))).toBe('mimetype');
  const files = unzipSync(bytes);
  expect(strFromU8(files.mimetype ?? new Uint8Array())).toBe('application/epub+zip');
  return files;
}

/** Reads every persisted segment state row straight from IndexedDB. */
export async function persistedSegments(page: Page): Promise<{ id: string; status: string; translationHtml?: string }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('epubtrans');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('segments', 'readonly').objectStore('segments').getAll();
          req.onsuccess = () => {
            resolve(req.result as { id: string; status: string; translationHtml?: string }[]);
            db.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/**
 * Stores a segment state row straight into IndexedDB, bypassing the app (so no cross-tab broadcast is sent):
 * what another tab's edit looks like to a tab that has not heard about it.
 */
export async function writeSegmentRowSilently(page: Page, row: { id: string; status: string; translationHtml: string }): Promise<void> {
  await page.evaluate(
    (segment) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('epubtrans');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const done = (error?: unknown) => {
            db.close();
            if (error) reject(error);
            else resolve();
          };
          const read = db.transaction('projects', 'readonly').objectStore('projects').getAllKeys();
          read.onerror = () => done(read.error);
          read.onsuccess = () => {
            const projectId = read.result[0];
            if (typeof projectId !== 'string') return done(new Error('no project in IndexedDB'));
            const tx = db.transaction('segments', 'readwrite');
            tx.objectStore('segments').put({ projectId, ...segment });
            tx.oncomplete = () => done();
            tx.onerror = () => done(tx.error);
          };
        };
      }),
    row,
  );
}
