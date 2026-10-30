import { describe, expect, it } from 'vitest';
import { detectFormat, importBook, TOC_CHAPTER_TITLE } from '../src';
import { readZip } from '../src/util/zip-archive';
import { env, readFixture, unzipText } from './test-helpers';

const FIXTURES = [
  { file: 'a-modest-proposal.epub', format: 'epub' },
  { file: 'a-modest-proposal.mobi', format: 'mobi' },
  { file: 'a-modest-proposal.azw3', format: 'azw3' },
  { file: 'aesop-fables.fb2', format: 'fb2' },
] as const;

describe('importBook', () => {
  for (const { file, format } of FIXTURES) {
    it(`imports ${format} (${file}) into chapters with segments and a title`, async () => {
      const bytes = readFixture(file);
      expect(detectFormat(bytes, file).format).toBe(format);
      const project = await importBook(bytes, file, env);
      expect(project.title.length).toBeGreaterThan(0);
      expect(project.schemaVersion).toBe(1);
      expect(project.chapters.length).toBeGreaterThan(0);
      const segments = project.chapters.flatMap((c) => c.segments);
      expect(segments.length).toBeGreaterThan(5);
      for (const c of project.chapters) expect(c.title.length).toBeGreaterThan(0);
      expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
      expect(segments.every((s) => s.status === 'pending' && s.sourceText.length > 0)).toBe(true);
      // TOC labels are part of the translatable content.
      expect(project.chapters[0]?.title).toBe(TOC_CHAPTER_TITLE);
      // Normalized package: mimetype first and every segment marker present.
      const files = readZip(project.sourceEpub);
      expect([...files.keys()][0]).toBe('mimetype');
      const marked = project.chapters.map((c) => unzipText(project.sourceEpub, c.href)).join('');
      for (const s of segments) expect(marked).toContain(`data-et-id="${s.id}"`);
    });
  }

  it('reads EPUB metadata and segments the prose', async () => {
    const project = await importBook(readFixture('a-modest-proposal.epub'), 'a.epub', env);
    expect(project.title).toMatch(/Modest Proposal/);
    expect(project.author).toMatch(/Swift/);
    const text = project.chapters.flatMap((c) => c.segments.map((s) => s.sourceText)).join('\n');
    expect(text).toMatch(/melancholy object/);
  });

  it('converts FB2 structure, notes and cover into the package', async () => {
    const project = await importBook(readFixture('aesop-fables.fb2'), 'aesop-fables.fb2', env);
    expect(project.title).toBe('Three Fables of Aesop');
    expect(project.author).toBe('Aesop');
    const titles = project.chapters.map((c) => c.title);
    expect(titles).toContain('The Fox and the Grapes');
    const segments = project.chapters.flatMap((c) => c.segments);
    expect(segments.some((s) => s.sourceHtml.includes('<em>'))).toBe(true);
    expect(segments.some((s) => s.sourceText.includes('print('))).toBe(false);
    const opf = unzipText(project.sourceEpub, 'OEBPS/content.opf');
    expect(opf).toContain('properties="cover-image"');
  });

  it('rejects unsupported input', async () => {
    await expect(importBook(new TextEncoder().encode('hello world, not a book'), 'x.txt', env)).rejects.toThrow(/Unsupported/);
  });
});
