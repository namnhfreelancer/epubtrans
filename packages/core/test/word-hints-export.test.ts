import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import {
  type ExportMode,
  exportEpub,
  generateProjectWordHints,
  HINT_EXPORT_MODES,
  importBook,
  loadProjectFile,
  type Project,
  planWordHints,
  saveProjectFile,
  type WordHintEntry,
  type WordHintSettings,
} from '../src';
import { parseXhtmlDocument } from '../src/dom/xhtml-document';
import { applyWordHints, planWordHintExport, type WordHintExport } from '../src/export/word-hint-markup';
import { readZip, writeEpubZip } from '../src/util/zip-archive';
import { env, fakeTranslate, glossProvider, makeProject, readFixture, readFrequencyList, segment, unzipText } from './test-helpers';

const CHAPTER = 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml';
const hintSettings = (patch: Partial<WordHintSettings> = {}): WordHintSettings => ({
  enabled: true,
  level: 3,
  style: 'ruby',
  maxPerParagraph: 0,
  perChapter: 0,
  ...patch,
});

/** The fixture book with generated hints (glosses "≈lemma"), optionally as an EPUB 2 package and translated. */
async function hintedProject(opts: { epub2?: boolean; translated?: boolean } = {}): Promise<Project> {
  let bytes = readFixture('a-modest-proposal.epub');
  if (opts.epub2) {
    const files = readZip(bytes);
    const opf = new TextDecoder().decode(files.get('OEBPS/content.opf'));
    files.set('OEBPS/content.opf', new TextEncoder().encode(opf.replace(/(<package\b[^>]*\bversion=")3\.0"/, '$12.0"')));
    bytes = writeEpubZip(files);
  }
  const project = await importBook(bytes, 'a.epub', env);
  project.settings.sourceLang = 'en';
  project.settings.wordHints = hintSettings({ maxPerParagraph: 3, perChapter: 1 });
  await generateProjectWordHints(project, planWordHints(project, readFrequencyList('en'), project.settings), glossProvider(), { concurrency: 4 });
  if (opts.translated) {
    for (const s of project.chapters.flatMap((c) => c.segments)) {
      s.translationHtml = fakeTranslate(s.sourceHtml);
      s.status = 'translated';
    }
  }
  return project;
}

function expectWellFormed(out: Uint8Array): void {
  for (const [name, data] of readZip(out)) {
    if (!/\.(xhtml|opf|ncx)$/.test(name)) continue;
    const text = new TextDecoder().decode(data);
    expect(XMLValidator.validate(text), name).toBe(true);
    const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, `${name} repeats ids`).toBe(ids.length);
  }
}

describe('Word Wise hints in exports', () => {
  it('writes ruby with rp fallback into the original-only export, without any translation', async () => {
    const project = await hintedProject();
    const out = await exportEpub(project, 'original', env);
    expectWellFormed(out);
    const html = unzipText(out, CHAPTER);
    expect(html).toMatch(
      /<ruby class="et-ww">prodigious<rp> \(<\/rp><rt (?=[^>]*\blang="vi")(?=[^>]*xml:lang="vi")[^>]*>≈prodigious<\/rt><rp>\)<\/rp><\/ruby>/,
    );
    expect(html).toContain('class="et-ww-p"');
    expect(html).toContain('epubtrans.css');
    expect(html).not.toContain('et-tr');
    expect(unzipText(out, 'OEBPS/epubtrans.css')).toContain('ruby.et-ww > rt');
    const opf = unzipText(out, 'OEBPS/content.opf');
    expect(opf.match(/<dc:language[^>]*>([^<]*)</g)).toEqual(['<dc:language>en<']);
    expect(opf).toContain('epubtrans-css');
    // The table of contents never gets hints.
    expect(unzipText(out, 'OEBPS/toc.xhtml')).not.toContain('<ruby');
    await expect(importBook(out, 'out.epub', env)).resolves.toBeTruthy();
  });

  it('puts hints on the source copy in bilingual modes and leaves translation-only without hints', async () => {
    const project = await hintedProject({ translated: true });
    for (const mode of HINT_EXPORT_MODES.filter((m) => m !== 'original')) {
      const out = await exportEpub(project, mode, env);
      expectWellFormed(out);
      const html = unzipText(out, CHAPTER);
      const source = /<p class="et-src et-ww-p">(?:(?!<\/p>)[\s\S])*prodigious(?:(?!<\/p>)[\s\S])*<\/p>/.exec(html)?.[0] ?? '';
      expect(source, mode).toContain('<ruby class="et-ww">prodigious');
      const translation = /<p\b[^>]*class="et-tr"[^>]*>(?:(?!<\/p>)[\s\S])*\[vi\] I think it is agreed(?:(?!<\/p>)[\s\S])*<\/p>/.exec(html)?.[0] ?? '';
      expect(translation, mode).not.toBe('');
      expect(translation, mode).not.toContain('<ruby');
    }
    const only = unzipText(await exportEpub(project, 'translation-only', env), CHAPTER);
    expect(only).not.toContain('<ruby');
    expect(only).not.toContain('et-ww');
  });

  it('writes inline hints for the inline style, and always for EPUB 2 packages (no ruby, xml:lang only)', async () => {
    const project = await hintedProject();
    project.settings.wordHints = hintSettings({ style: 'inline', maxPerParagraph: 3, perChapter: 1 });
    const inline = unzipText(await exportEpub(project, 'original', env), CHAPTER);
    expect(inline).toMatch(/prodigious<span (?=[^>]*class="et-ww-i")(?=[^>]*\blang="vi")(?=[^>]*xml:lang="vi")[^>]*> \(≈prodigious\)<\/span>/);
    expect(inline).not.toContain('<ruby');
    expect(inline).not.toContain('et-ww-p');

    const epub2 = await hintedProject({ epub2: true, translated: true });
    expect(epub2.settings.wordHints?.style).toBe('ruby');
    for (const mode of HINT_EXPORT_MODES as ExportMode[]) {
      const out = await exportEpub(epub2, mode, env);
      expectWellFormed(out);
      const html = unzipText(out, CHAPTER);
      expect(html, mode).not.toContain('<ruby');
      expect(html, mode).toMatch(/prodigious<span (?=[^>]*class="et-ww-i")(?=[^>]*xml:lang="vi")[^>]*> \(≈prodigious\)<\/span>/);
      expect(html, mode).not.toMatch(/\slang="vi"/);
    }
  });

  it('exports no hints when they are disabled', async () => {
    const project = await hintedProject();
    project.settings.wordHints = hintSettings({ enabled: false });
    const out = await exportEpub(project, 'original', env);
    expect(unzipText(out, CHAPTER)).not.toContain('et-ww');
    expect([...readZip(out).keys()].some((k) => k.endsWith('epubtrans.css'))).toBe(false);
  });
});

describe('hint density at export', () => {
  const entry = (lemma: string, rank: number, occurrences: [string, string, number, string?][], senses = ['main']): WordHintEntry => ({
    lemma,
    rank,
    senses: senses.map((id) => ({ id, gloss: `${lemma}:${id}` })),
    occurrences: occurrences.map(([segmentId, word, nth, sense]) => ({ segmentId, word, nth, sense: sense ?? 'main' })),
  });
  const densityProject = (settings: WordHintSettings) => {
    const project = makeProject([[segment('c0-0', 'x'), segment('c0-1', 'x')], [segment('c1-0', 'x')]]);
    project.settings.wordHints = settings;
    project.wordHints = {
      sourceLang: 'en',
      glossLang: 'vi',
      entries: [
        entry(
          'bank',
          12_000,
          [
            ['c0-0', 'bank', 0, 'river'],
            ['c0-0', 'bank', 1, 'money'],
            ['c0-1', 'bank', 0, 'river'],
            ['c1-0', 'bank', 0, 'river'],
          ],
          ['river', 'money'],
        ),
        entry('rare', 30_000, [['c0-0', 'rare', 0]]),
        entry('common', 6_000, [['c0-0', 'common', 0]]),
      ],
    };
    return project;
  };
  const placed = (project: Project) =>
    Object.fromEntries(
      [...(planWordHintExport(project, 'original', false)?.placements ?? [])].map(([id, list]) => [id, list.map((p) => `${p.word}${p.nth}:${p.gloss}`)]),
    );

  it('keeps every hint above the level threshold without limits', () => {
    expect(placed(densityProject(hintSettings()))).toEqual({
      'c0-0': ['bank0:bank:river', 'bank1:bank:money', 'rare0:rare:main'],
      'c0-1': ['bank0:bank:river'],
      'c1-0': ['bank0:bank:river'],
    });
  });

  it('a higher level shows more words, a lower one fewer, without new requests', () => {
    expect(placed(densityProject(hintSettings({ level: 4 })))['c0-0']).toContain('common0:common:main');
    expect(placed(densityProject(hintSettings({ level: 1 })))).toEqual({ 'c0-0': ['rare0:rare:main'] });
  });

  it('filters each occurrence by the rank of its own form, falling back to the entry rank for older files', () => {
    const project = densityProject(hintSettings({ level: 1 }));
    project.wordHints?.entries.push({
      lemma: 'frustrate',
      rank: 28_991,
      senses: [{ id: 'main', gloss: 'làm nản' }],
      occurrences: [
        { segmentId: 'c0-1', word: 'frustrate', nth: 0, sense: 'main', rank: 28_991 },
        { segmentId: 'c1-0', word: 'frustrating', nth: 0, sense: 'main', rank: 7_418 },
      ],
    });
    expect(placed(project)).toEqual({ 'c0-0': ['rare0:rare:main'], 'c0-1': ['frustrate0:làm nản'] });
    project.settings.wordHints = hintSettings({ level: 4 });
    expect(placed(project)['c1-0']).toEqual(['bank0:bank:river', 'frustrating0:làm nản']);
  });

  it('limits hints to the first N occurrences of a sense per chapter', () => {
    expect(placed(densityProject(hintSettings({ perChapter: 1 })))).toEqual({
      'c0-0': ['bank0:bank:river', 'bank1:bank:money', 'rare0:rare:main'],
      'c1-0': ['bank0:bank:river'],
    });
  });

  it('keeps the rarest words when a paragraph has more hints than allowed', () => {
    expect(placed(densityProject(hintSettings({ maxPerParagraph: 2 })))['c0-0']).toEqual(['rare0:rare:main', 'bank0:bank:river']);
  });

  it('has nothing to place in translation-only mode or without generated hints', () => {
    const project = densityProject(hintSettings());
    expect(planWordHintExport(project, 'translation-only', false)).toBeUndefined();
    delete project.wordHints;
    expect(planWordHintExport(project, 'bilingual', false)).toBeUndefined();
  });
});

describe('applyWordHints', () => {
  const plan = (style: 'ruby' | 'inline'): WordHintExport => ({ placements: new Map(), style, glossLang: 'vi', segmentLang: 'en' });
  const paragraph = (inner: string) => {
    const doc = parseXhtmlDocument(env, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>${inner}</p></body></html>`);
    return doc.querySelector('p') as Element;
  };

  it('finds the nth occurrence across text nodes, skips code, and writes glosses as text only', () => {
    const p = paragraph('A bank, <i>a bank</i> and <code>bank</code> and a bank.');
    const written = applyWordHints(
      p,
      [
        { word: 'bank', nth: 1, gloss: '<b>bờ</b>', rank: 1 },
        { word: 'bank', nth: 2, gloss: 'ngân hàng', rank: 1 },
      ],
      plan('ruby'),
      false,
    );
    expect(written).toBe(2);
    // Attribute order differs between DOM implementations.
    const html = String(p).replace(/<rt [^>]*>/g, '<rt>');
    expect(html).toContain('<i>a <ruby class="et-ww">bank<rp> (</rp><rt>&lt;b&gt;bờ&lt;/b&gt;</rt><rp>)</rp></ruby></i>');
    expect(html).toContain('<code>bank</code>');
    expect(html).toContain('a <ruby class="et-ww">bank<rp> (</rp><rt>ngân hàng</rt><rp>)</rp></ruby>.');
    expect(String(p)).toMatch(/<rt (?=[^>]*\blang="vi")(?=[^>]*xml:lang="vi")/);
    expect(html.startsWith('<p>A bank, ')).toBe(true);
  });

  it('never writes a hint into a drop cap or a word split by markup, even when a placement names it', () => {
    const p = paragraph('<span class="dropcap">A</span>lthough the <b>W</b>hen bank.');
    const written = applyWordHints(
      p,
      [
        { word: 'lthough', nth: 0, gloss: 'x', rank: 1 },
        { word: 'hen', nth: 0, gloss: 'y', rank: 1 },
        { word: 'bank', nth: 0, gloss: 'z', rank: 1 },
      ],
      plan('inline'),
      true,
    );
    expect(written).toBe(1);
    expect(String(p)).toContain('<span class="dropcap">A</span>lthough the <b>W</b>hen bank<span');
  });

  it('never writes a hint into link text', () => {
    const p = paragraph('<a href="#x">bank</a> and bank');
    // Link text is not counted either, so the bank after the link is the first one.
    expect(applyWordHints(p, [{ word: 'bank', nth: 0, gloss: 'z', rank: 1 }], plan('inline'), true)).toBe(1);
    expect(String(p)).toContain('<a href="#x">bank</a> and bank<span');
  });

  it('skips an occurrence that no longer matches', () => {
    const p = paragraph('Only one bank.');
    expect(applyWordHints(p, [{ word: 'bank', nth: 3, gloss: 'x', rank: 1 }], plan('inline'), true)).toBe(0);
    expect(String(p)).toBe('<p>Only one bank.</p>');
  });
});

describe('changing the level after generating', () => {
  const en = readFrequencyList('en');
  const frustrateProject = (level: number) => {
    const project = makeProject([[segment('c0-0', 'Delays frustrate everyone here.')], [segment('c1-0', 'It was a frustrating morning.')]]);
    project.settings.wordHints = hintSettings({ level });
    return project;
  };
  const exported = (project: Project) =>
    [...(planWordHintExport(project, 'original', false)?.placements ?? [])].map(([id, list]) => [id, list.map((p) => p.word)]);

  it('lowering the level at export keeps the forms a fresh run at that level would hint, without new requests', async () => {
    const project = frustrateProject(5);
    await generateProjectWordHints(project, planWordHints(project, en, project.settings), glossProvider(), { concurrency: 1 });
    project.settings.wordHints = hintSettings({ level: 1 });
    expect(exported(project)).toEqual([['c0-0', ['frustrate']]]);
    expect(planWordHints(project, en, project.settings).candidates).toEqual([]);

    const fresh = frustrateProject(1);
    await generateProjectWordHints(fresh, planWordHints(fresh, en, fresh.settings), glossProvider(), { concurrency: 1 });
    expect(exported(fresh)).toEqual(exported(project));
  });

  it('raising the level adds only new lemmas and shows the common forms of lemmas glossed before', async () => {
    const project = frustrateProject(1);
    await generateProjectWordHints(project, planWordHints(project, en, project.settings), glossProvider(), { concurrency: 1 });
    expect(exported(project)).toEqual([['c0-0', ['frustrate']]]);

    project.settings.wordHints = hintSettings({ level: 5 });
    const plan = planWordHints(project, en, project.settings);
    expect(plan.candidates.map((c) => c.lemma)).toEqual(['delay']);
    const provider = glossProvider();
    await generateProjectWordHints(project, plan, provider, { concurrency: 1 });
    const sent = provider.calls.flatMap((c) => (JSON.parse(c.user) as { items: { lemma: string }[] }).items.map((i) => i.lemma));
    expect([...new Set(sent)]).toEqual(['delay']);
    expect(exported(project)).toEqual([
      ['c0-0', ['frustrate', 'Delays']],
      ['c1-0', ['frustrating']],
    ]);
    expect(planWordHints(project, en, project.settings).candidates).toEqual([]);
  });
});

describe('XML-invalid characters from the model or a crafted file', () => {
  it('drops them from glosses and translations, so the export stays well-formed', async () => {
    const project = await hintedProject({ translated: true });
    const entry = project.wordHints?.entries.find((e) => e.lemma === 'prodigious') as WordHintEntry;
    (entry.senses[0] as { gloss: string }).gloss = 'bad\uFFFFgloss\uFFFE\u0001';
    const segmentWithText = project.chapters.flatMap((c) => c.segments).find((s) => s.translationHtml?.includes('I think it is agreed'));
    if (segmentWithText) segmentWithText.translationHtml = `${segmentWithText.translationHtml}\uFFFF\uD800`;
    for (const mode of HINT_EXPORT_MODES) {
      const out = await exportEpub(project, mode, env);
      expectWellFormed(out);
      const html = unzipText(out, CHAPTER);
      expect(html).toContain('badgloss');
      expect(html).not.toMatch(/[\uFFFE\uFFFF]/);
      expect(html.includes('\u0001')).toBe(false);
    }
  });
});

describe('project files with hints', () => {
  it('round-trips hint settings and glosses, and loads files without them', async () => {
    const project = await hintedProject();
    const loaded = await loadProjectFile(await saveProjectFile(project));
    expect(loaded.settings.wordHints).toEqual(project.settings.wordHints);
    expect(loaded.wordHints).toEqual(project.wordHints);

    const { wordHints: _hints, ...older } = project;
    const { wordHints: _settings, ...olderSettings } = project.settings;
    const old = await loadProjectFile(await saveProjectFile({ ...older, settings: olderSettings }));
    expect(old.wordHints).toBeUndefined();
    expect(old.settings.wordHints).toBeUndefined();
  });

  it('clamps hint settings and rejects occurrences that name an unknown sense', async () => {
    const project = makeProject([[segment('c0-0', 'x')]]);
    const bytes = async (patch: Record<string, unknown>) => saveProjectFile({ ...project, ...patch } as Project);
    const odd = await loadProjectFile(
      await bytes({ settings: { ...project.settings, wordHints: { enabled: true, level: 9, style: 'fancy', maxPerParagraph: -2, perChapter: 7.6 } } }),
    );
    expect(odd.settings.wordHints).toEqual({ enabled: true, level: 5, style: 'ruby', maxPerParagraph: 0, perChapter: 8 });
    const bad = {
      wordHints: {
        sourceLang: 'en',
        glossLang: 'vi',
        entries: [{ lemma: 'a', rank: 1, senses: [], occurrences: [{ segmentId: 'c0-0', word: 'a', nth: 0, sense: 'x' }] }],
      },
    };
    await expect(loadProjectFile(await bytes(bad))).rejects.toThrow(/sense/);
    const badRank = {
      wordHints: {
        sourceLang: 'en',
        glossLang: 'vi',
        entries: [
          { lemma: 'a', rank: 1, senses: [{ id: 'm', gloss: 'g' }], occurrences: [{ segmentId: 'c0-0', word: 'a', nth: 0, sense: 'm', rank: 'high' }] },
        ],
      },
    };
    await expect(loadProjectFile(await bytes(badRank))).rejects.toThrow(/rank/);
  });
});
