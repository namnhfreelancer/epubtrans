import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { EXPORT_MODES, type ExportMode, exportEpub, importBook, type Project, translateProject } from '../src';
import { readZip, writeEpubZip } from '../src/util/zip-archive';
import { answerAll, env, fakeTranslate, mockProvider, readFixture, unzipText } from './test-helpers';

async function translatedProject(file: string): Promise<Project> {
  const project = await importBook(readFixture(file), file, env);
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = fakeTranslate(s.sourceHtml);
    s.status = 'translated';
  }
  return project;
}

function expectValidContainer(bytes: Uint8Array): Map<string, Uint8Array> {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  expect(ascii(0, 4)).toBe('PK\u0003\u0004');
  expect((bytes[8] ?? 1) | ((bytes[9] ?? 0) << 8)).toBe(0); // stored, not deflated
  expect((bytes[28] ?? 1) | ((bytes[29] ?? 0) << 8)).toBe(0); // no extra field
  expect(ascii(30, 38)).toBe('mimetype');
  expect(ascii(38, 58)).toBe('application/epub+zip');
  const files = readZip(bytes);
  for (const [name, data] of files) {
    if (!/\.(xhtml|html|opf|ncx|xml)$/.test(name)) continue;
    const text = new TextDecoder().decode(data);
    const result = XMLValidator.validate(text);
    expect(result, `${name} must be well-formed XML`).toBe(true);
    expect(text).not.toContain('data-et-id');
    const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, `${name} must not repeat ids`).toBe(ids.length);
  }
  return files;
}

describe('exportEpub', () => {
  for (const mode of EXPORT_MODES) {
    it(`exports ${mode} as a valid, re-importable EPUB`, async () => {
      const project = await translatedProject('a-modest-proposal.epub');
      const out = await exportEpub(project, mode, env);
      const files = expectValidContainer(out);
      const chapter = project.chapters[2];
      if (!chapter) throw new Error('fixture changed');
      const html = unzipText(out, chapter.href);
      expect(html).toContain('[vi] ');
      expect(html).toMatch(/lang="vi"/);
      expect(html).toMatch(/xml:lang="vi"/);
      const opf = unzipText(out, 'OEBPS/content.opf');
      const css = [...files.keys()].some((k) => k.endsWith('epubtrans.css'));
      if (mode === 'translation-only') {
        expect(html).not.toContain('et-src');
        expect(html.replaceAll('[vi] It is a melancholy object', '')).not.toContain('It is a melancholy object');
        expect(css).toBe(false);
        expect(opf).toMatch(/<dc:language[^>]*>vi<\/dc:language>/);
      } else {
        expect(html).toContain('melancholy object');
        expect(html).toContain('class="et-src"');
        expect(css).toBe(true);
        expect(opf).toContain('epubtrans.css');
        const src = html.indexOf('It is a melancholy object');
        const tr = html.indexOf('[vi] It is a melancholy object');
        expect(src).toBeGreaterThan(-1);
        expect(tr).toBeGreaterThan(-1);
        expect(mode === 'bilingual' ? src < tr : tr < src).toBe(true);
      }
      // TOC is translated in the nav document and in the NCX fallback.
      expect(unzipText(out, 'OEBPS/toc.ncx')).toContain('[vi] A Modest Proposal');
      // epubcheck rejects aria-label on <nav>; the source book has one.
      expect(unzipText(out, 'OEBPS/toc.xhtml')).not.toMatch(/<nav[^>]*aria-label/);
      const reimported = await importBook(out, 'out.epub', env);
      expect(reimported.chapters.flatMap((c) => c.segments).length).toBeGreaterThan(0);
    });
  }

  for (const file of ['a-modest-proposal.mobi', 'a-modest-proposal.azw3', 'aesop-fables.fb2']) {
    it(`exports a converted ${file.split('.').pop()} book as well-formed EPUB`, async () => {
      const project = await translatedProject(file);
      for (const mode of EXPORT_MODES as ExportMode[]) {
        const out = await exportEpub(project, mode, env);
        expectValidContainer(out);
        await expect(importBook(out, 'out.epub', env)).resolves.toBeTruthy();
      }
    });
  }

  it('keeps one copy of page-marker ids whatever the mode', async () => {
    const files = readZip(readFixture('a-modest-proposal.epub'));
    const path = 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml';
    const chapter = new TextDecoder().decode(files.get(path));
    files.set(path, new TextEncoder().encode(chapter.replace('It is a melancholy object', 'It is a <a id="p1"></a>melancholy object')));
    const project = await importBook(writeEpubZip(files), 'marked.epub', env);
    // A model that drops empty anchors, as real models do when they restructure a sentence.
    const dropping = mockProvider((req) => answerAll({ ...req, user: req.user.replace(/<a id=\\"[^"\\]*\\"><\/a>/g, '') }));
    await translateProject(project, dropping, project.settings);
    const marked = project.chapters.flatMap((c) => c.segments).find((s) => s.sourceHtml.includes('id="p1"'));
    expect(marked?.status).toBe('translated');
    expect(marked?.translationHtml).toContain('<a id="p1"></a>');
    for (const mode of EXPORT_MODES) {
      const html = unzipText(await exportEpub(project, mode, env), path);
      expect(html.match(/id="p1"/g), mode).toHaveLength(1);
      const holder = /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*id="p1"/.exec(html)?.[0] ?? '';
      // The source keeps the link target in bilingual modes; translation-only has only the translated paragraph.
      if (mode === 'translation-only') expect(holder).toContain('[vi] ');
      else expect(holder).toContain('class="et-src"');
    }
  });

  it('keeps untranslated segments as source and keeps list structure intact', async () => {
    const project = await translatedProject('aesop-fables.fb2');
    const first = project.chapters[1]?.segments[0];
    if (!first) throw new Error('fixture changed');
    first.status = 'pending';
    delete first.translationHtml;
    const out = await exportEpub(project, 'bilingual', env);
    const nav = unzipText(out, 'OEBPS/nav.xhtml');
    // One <a> per TOC entry: translations are merged inside the label.
    expect(nav.match(/<a /g)?.length).toBe(5);
    expect(nav).toMatch(/<a [^>]*><span class="et-src">The Fox and the Grapes<\/span> \/ <span [^>]*class="et-tr"[^>]*>\[vi\] The Fox/);
    const chapter = unzipText(out, project.chapters[1]?.href ?? '');
    expect(chapter).toContain('Three Fables of Aesop');
    expect(chapter).not.toContain('[vi] Three Fables');
  });
});
