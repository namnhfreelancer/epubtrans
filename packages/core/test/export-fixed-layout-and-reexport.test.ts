import { describe, expect, it } from 'vitest';
import { attributionText, exportEpub, exportIdentifier, importBook, loadProjectFile, type Project, saveProjectFile } from '../src';
import { readZip } from '../src/util/zip-archive';
import { buildEpub2Book } from './epub2-fixture';
import { buildFixedLayoutBook, FIXED_LAYOUT_IDENTIFIER, FIXED_LAYOUT_ISBN } from './fixed-layout-fixture';
import { env, fakeTranslate, readFixture, unzipText } from './test-helpers';

async function translated(bytes: Uint8Array, name: string, model = 'claude-opus-5.5'): Promise<Project> {
  const project = await importBook(bytes, name, env);
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = fakeTranslate(s.sourceHtml);
    s.status = 'translated';
  }
  project.settings = { ...project.settings, model, attribution: true };
  return project;
}

const count = (text: string, pattern: RegExp) => text.match(new RegExp(pattern, 'g'))?.length ?? 0;

describe('fixed-layout EPUB 3', () => {
  it('makes the attribution page reflowable, so it needs no viewport', async () => {
    const out = await exportEpub(await translated(buildFixedLayoutBook(), 'fxl.epub'), 'bilingual', env);
    const opf = unzipText(out, 'OEBPS/package.opf');
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    const itemref = /<itemref [^>]*idref="epubtrans-attribution"[^>]*\/><\/spine>/.exec(opf)?.[0];
    expect(itemref).toContain('properties="rendition:layout-reflowable"');
    // The book's own pages keep their layout.
    expect(opf).toMatch(/<itemref idref="p1"\s*\/>/);
    expect(unzipText(out, 'OEBPS/epubtrans-attribution.xhtml')).toContain('Dịch bằng claude-opus-5.5 với epubtrans');
  });

  it('leaves reflowable EPUB 3 and EPUB 2 spines without layout overrides', async () => {
    for (const [bytes, opfPath] of [
      [readFixture('a-modest-proposal.epub'), 'OEBPS/content.opf'],
      [buildEpub2Book(), 'OEBPS/content.opf'],
    ] as const) {
      const opf = unzipText(await exportEpub(await translated(bytes, 'b.epub'), 'bilingual', env), opfPath);
      expect(opf).toMatch(/<itemref idref="epubtrans-attribution"\s*\/>/);
      expect(opf).not.toContain('rendition:layout-reflowable');
    }
  });

  it('derives the export identifier from the identifier unique-identifier names, not the first one', async () => {
    const out = await exportEpub(await translated(buildFixedLayoutBook(), 'fxl.epub'), 'translation-only', env);
    const opf = unzipText(out, 'OEBPS/package.opf');
    const expected = exportIdentifier(FIXED_LAYOUT_IDENTIFIER, 'vi', 'translation-only');
    expect(expected).not.toBe(exportIdentifier(FIXED_LAYOUT_ISBN, 'vi', 'translation-only'));
    expect(opf).toContain(`<dc:identifier id="epubtrans-uid">${expected}</dc:identifier>`);
    expect(opf).toContain(`<dc:source>${FIXED_LAYOUT_IDENTIFIER}</dc:source>`);
    expect(opf).toContain(`<dc:identifier id="isbn">${FIXED_LAYOUT_ISBN}</dc:identifier>`);
    expect(opf).not.toContain(`<dc:source>${FIXED_LAYOUT_ISBN}</dc:source>`);
  });
});

describe('exporting an epubtrans export again', () => {
  it('keeps one attribution page and one generated identifier, derived from the original book', async () => {
    const first = await exportEpub(await translated(readFixture('a-modest-proposal.epub'), 'a.epub', 'model-one'), 'bilingual', env);
    const again = await translated(first, 'a.vi.epub', 'model-two');
    // The earlier attribution page is not book text: nothing of it is offered for translation.
    expect(again.chapters.some((c) => c.href.includes('epubtrans-attribution'))).toBe(false);

    const out = await exportEpub(again, 'translation-only', env);
    const files = readZip(out);
    const opf = unzipText(out, 'OEBPS/content.opf');
    expect([...files.keys()].filter((k) => k.includes('attribution'))).toEqual(['OEBPS/epubtrans-attribution.xhtml']);
    expect(count(opf, /<itemref idref="epubtrans-attribution/)).toBe(1);
    expect(count(opf, /<item [^>]*epubtrans-attribution/)).toBe(1);
    const page = unzipText(out, 'OEBPS/epubtrans-attribution.xhtml');
    expect(page).toContain('model-two');
    expect(page).not.toContain('model-one');

    const original = 'http://www.gutenberg.org/1080';
    expect(count(opf, /<dc:identifier id="epubtrans-uid/)).toBe(1);
    expect(opf).toContain(`<dc:identifier id="epubtrans-uid">${exportIdentifier(original, 'vi', 'translation-only')}</dc:identifier>`);
    expect(opf).toContain('unique-identifier="epubtrans-uid"');
    // The book's own dc:source (its Gutenberg page) plus the original identifier, recorded once.
    expect(count(opf, new RegExp(`<dc:source>${original}</dc:source>`))).toBe(1);
  });

  it('replaces the earlier page in EPUB 2 books too, and keeps it when this export adds none', async () => {
    const first = await exportEpub(await translated(buildEpub2Book(), 'b.epub', 'model-one'), 'bilingual', env);
    const again = await translated(first, 'b.vi.epub', 'model-two');
    const out = await exportEpub(again, 'bilingual', env);
    expect(count(unzipText(out, 'OEBPS/content.opf'), /<itemref idref="epubtrans-attribution/)).toBe(1);
    expect(unzipText(out, 'OEBPS/epubtrans-attribution.xhtml')).toContain('model-two');
    expect(count(unzipText(out, 'OEBPS/toc.ncx'), /name="dtb:uid"/)).toBe(1);

    const original = await exportEpub(again, 'original', env);
    expect(unzipText(original, 'OEBPS/epubtrans-attribution.xhtml')).toContain('model-one');
  });
});

describe('attribution phrases', () => {
  it('uses Traditional Chinese for zh-Hant, Taiwan, Hong Kong and Macau', () => {
    for (const tag of ['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-CN']) {
      expect(attributionText(tag, 'm')).toEqual({ lang: tag, text: '由 epubtrans 使用 m 翻譯' });
    }
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-Hans-TW']) {
      expect(attributionText(tag, 'm')).toEqual({ lang: tag, text: '由 epubtrans 使用 m 翻译' });
    }
  });
});

describe('project files from a newer version', () => {
  it('load with unknown export style keys dropped and reported, but invalid values still fail', async () => {
    const project = await importBook(buildEpub2Book(), 'b.epub', env);
    const future = { source: { color: '#123456', shadow: '1px' }, pageMargins: 2 };
    project.settings = { ...project.settings, exportStyle: future } as unknown as Project['settings'];
    const ignored: string[] = [];
    const loaded = await loadProjectFile(await saveProjectFile(project), { onIgnoredKey: (key) => ignored.push(key) });
    expect(loaded.settings.exportStyle).toEqual({ source: { color: '#123456' } });
    expect(ignored).toEqual(['settings.exportStyle.pageMargins', 'settings.exportStyle.source.shadow']);
    // Without a handler the keys are dropped silently; the project still loads.
    expect((await loadProjectFile(await saveProjectFile(project))).settings.exportStyle).toEqual({ source: { color: '#123456' } });

    project.settings = { ...project.settings, exportStyle: { pageMargins: 2, blockSpacingEm: 99 } } as unknown as Project['settings'];
    await expect(loadProjectFile(await saveProjectFile(project))).rejects.toThrow(/settings\.exportStyle\.blockSpacingEm/);
  });
});
