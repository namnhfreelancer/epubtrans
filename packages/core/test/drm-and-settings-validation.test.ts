import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importBook, validateProjectState } from '../src';
import { readZip, writeEpubZip } from '../src/util/zip-archive';
import { env, readFixture } from './test-helpers';

/** The EPUB fixture with an extra file in it. */
function epubWith(path: string, content: string): Uint8Array {
  const files = readZip(readFixture('a-modest-proposal.epub'));
  files.set(path, strToU8(content));
  return writeEpubZip(files);
}

describe('DRM detection', () => {
  it.each([
    ['META-INF/license.lcpl', 'Readium LCP'],
    ['META-INF/sinf.xml', 'Apple FairPlay'],
    ['META-INF/rights.xml', 'Adobe ADEPT'],
  ])('rejects %s as %s', async (path, scheme) => {
    await expect(importBook(epubWith(path, '{}'), 'book.epub', env)).rejects.toThrow(
      `This book is DRM-protected (${scheme}); only DRM-free books are supported`,
    );
  });

  it('rejects encrypted content but accepts font obfuscation', async () => {
    const encryption = (algorithm: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/></enc:EncryptedData></encryption>`;
    await expect(importBook(epubWith('META-INF/encryption.xml', encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc')), 'b.epub', env)).rejects.toThrow(
      /DRM-protected \(encrypted content\)/,
    );
    const project = await importBook(epubWith('META-INF/encryption.xml', encryption('http://www.idpf.org/2008/embedding')), 'b.epub', env);
    expect(project.chapters.length).toBeGreaterThan(0);
  });
});

describe('new optional settings in project state', () => {
  const state = (settings: Record<string, unknown>) => ({
    schemaVersion: 1,
    id: 'p',
    title: 'T',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      sourceLang: 'en',
      targetLang: 'vi',
      providerId: 'openai',
      baseURL: '',
      model: '',
      concurrency: 1,
      twoPass: false,
      guideline: '',
      glossary: [],
      ...settings,
    },
    chapters: [
      { href: 'a', title: 'A', segments: [{ id: 'c0-0', sourceHtml: 'x', sourceText: 'x', status: 'translated', translationHtml: 'x', warning: 'identical' }] },
    ],
  });

  it('keeps valid values and the identical warning', () => {
    const loaded = validateProjectState(state({ maxSegmentsPerBatch: 16, identicalMinLetters: 0, cachedInputRatio: 0.1, reasoning: 'low' }));
    expect(loaded.settings).toMatchObject({ maxSegmentsPerBatch: 16, identicalMinLetters: 0, cachedInputRatio: 0.1, reasoning: 'low' });
    expect(loaded.chapters[0]?.segments[0]?.warning).toBe('identical');
  });

  it('rejects out-of-range values and drops unknown future values', () => {
    expect(() => validateProjectState(state({ maxSegmentsPerBatch: 0 }))).toThrow(/maxSegmentsPerBatch must be an integer between 1 and 200/);
    expect(() => validateProjectState(state({ identicalMinLetters: 2.5 }))).toThrow(/identicalMinLetters/);
    expect(() => validateProjectState(state({ cachedInputRatio: 3 }))).toThrow(/cachedInputRatio/);
    const future = validateProjectState({
      ...state({ reasoning: 'max' }),
      chapters: [{ href: 'a', title: 'A', segments: [{ id: 'c0-0', sourceHtml: 'x', sourceText: 'x', status: 'pending', warning: 'later' }] }],
    });
    expect(future.settings).not.toHaveProperty('reasoning');
    expect(future.chapters[0]?.segments[0]).not.toHaveProperty('warning');
  });
});
