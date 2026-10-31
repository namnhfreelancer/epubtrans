import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EMBEDDED_FONT_FILES,
  EMBEDDED_FONTS,
  EXPORT_STYLE_PRESET_IDS,
  type ExportStyle,
  ExportStyleError,
  embeddedFontsFor,
  embeddedFontsSize,
  exportEpub,
  exportStyleCss,
  exportStylePreset,
  importBook,
  matchingPreset,
  normalizeColor,
  type Project,
  validateExportStyle,
} from '../src';
import { readZip } from '../src/util/zip-archive';
import { buildEpub2Book } from './epub2-fixture';
import { env, fakeTranslate, loadFontFile, readFixture, unzipText } from './test-helpers';

const LEGACY_CSS = `/* epubtrans: bilingual layout and Word Wise hints */
.et-src { opacity: 0.55; }
ruby.et-ww > rt { font-size: 0.55em; font-style: normal; font-weight: normal; }
.et-ww-p { line-height: 2; }
.et-ww-i { font-size: 0.8em; opacity: 0.75; }
`;

async function translatedBook(bytes = readFixture('a-modest-proposal.epub'), name = 'a.epub'): Promise<Project> {
  const project = await importBook(bytes, name, env);
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = fakeTranslate(s.sourceHtml);
    s.status = 'translated';
  }
  return project;
}

const withStyle = (project: Project, exportStyle: ExportStyle): Project => ({ ...project, settings: { ...project.settings, exportStyle } });
const cssOf = (out: Uint8Array) => unzipText(out, [...readZip(out).keys()].find((k) => k.endsWith('epubtrans.css')) ?? 'missing');

describe('export style validation', () => {
  it('normalizes colors and keeps valid values', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor(' #0F766E ')).toBe('#0f766e');
    expect(normalizeColor('rgb(20, 40, 255)')).toBe('#1428ff');
    expect(normalizeColor('rgb(256, 0, 0)')).toBeUndefined();
    const style = validateExportStyle({
      preset: 'learner',
      source: { color: 'rgb(1,2,3)', opacity: 0.555, fontSizePercent: 90, italic: true, font: 'literata' },
      translation: { color: '#FFF', font: 'sans-serif', fontWeight: 600, fontSizePercent: 110 },
      blockSpacingEm: 0.5,
      hint: { color: '#123456', fontSizePercent: 60 },
    });
    expect(style).toEqual({
      preset: 'learner',
      source: { color: '#010203', opacity: 0.56, fontSizePercent: 90, italic: true, font: 'literata' },
      translation: { color: '#ffffff', font: 'sans-serif', fontWeight: 600, fontSizePercent: 110 },
      blockSpacingEm: 0.5,
      hint: { color: '#123456', fontSizePercent: 60 },
    });
    expect(validateExportStyle({ source: {} })).toEqual({});
  });

  it.each([
    ['a brace closing the rule', { source: { color: 'red}' } }],
    ['a declaration smuggled after a color', { source: { color: '#fff; background: url(x)' } }],
    ['a url()', { translation: { color: 'url(https://evil.example/x.png)' } }],
    ['a named color', { hint: { color: 'red' } }],
    ['an rgba color', { hint: { color: 'rgba(0,0,0,0.5)' } }],
    ['a comment', { source: { color: '#fff/*' } }],
    ['expression()', { source: { color: 'expression(alert(1))' } }],
    ['a font family outside the allowlist', { source: { font: 'Comic Sans' } }],
    ['a font family with CSS in it', { translation: { font: '"Literata"; } body { background: red' } }],
    ['an unknown key', { source: { background: '#000' } }],
    ['an unknown top-level key', { css: 'body{}' }],
    ['an opacity above 1', { source: { opacity: 1.5 } }],
    ['an opacity as a string', { source: { opacity: '0.5' } }],
    ['a size below the range', { source: { fontSizePercent: 10 } }],
    ['a fractional size', { translation: { fontSizePercent: 90.5 } }],
    ['a size of NaN', { hint: { fontSizePercent: Number.NaN } }],
    ['a spacing above the range', { blockSpacingEm: 4 }],
    ['a weight outside the list', { translation: { fontWeight: 450 } }],
    ['an unknown preset', { preset: 'neon' }],
    ['italic as a string', { source: { italic: 'yes' } }],
    ['an array', []],
  ])('rejects %s', (_, input) => {
    expect(() => validateExportStyle(input)).toThrow(ExportStyleError);
  });

  it('every preset is valid and recognized', () => {
    for (const id of EXPORT_STYLE_PRESET_IDS) {
      expect(validateExportStyle(exportStylePreset(id))).toEqual(exportStylePreset(id));
      expect(matchingPreset(exportStylePreset(id))).toBe(id);
    }
    expect(matchingPreset(undefined)).toBe('classic');
    expect(matchingPreset({})).toBe('classic');
    expect(matchingPreset({ source: { italic: true } })).toBeUndefined();
    expect(matchingPreset({ source: { opacity: 0.3 } })).toBeUndefined();
  });
});

describe('export style beats the book stylesheet', () => {
  it('marks every chosen value !important, so selectors like p.ct in the book cannot override it', () => {
    const style = validateExportStyle({ source: { opacity: 0.7 }, translation: { color: '#888888', fontSizePercent: 80 } });
    const css = exportStyleCss(style, { fonts: [], attribution: false });
    expect(css).toContain('.et-src { opacity: 0.7 !important; }');
    expect(css).toContain('.et-tr { color: #888888 !important; font-size: 80% !important; }');
  });
});

describe('export style CSS', () => {
  it('is the legacy stylesheet without a style', () => {
    expect(exportStyleCss(undefined, { fonts: [], attribution: false })).toBe(LEGACY_CSS);
    expect(exportStyleCss(exportStylePreset('classic'), { fonts: [], attribution: false })).toBe(LEGACY_CSS);
  });

  it('emits every value, never a background, and only the bundled font URLs', () => {
    const style = validateExportStyle({
      source: { color: '#555', opacity: 0.8, fontSizePercent: 90, italic: true, font: 'literata' },
      translation: { color: '#123456', font: 'noto-sans', fontWeight: 'bold', fontSizePercent: 110 },
      blockSpacingEm: 1,
      hint: { color: '#abcdef', fontSizePercent: 100 },
    });
    const css = exportStyleCss(style, { fonts: embeddedFontsFor(style, 'bilingual'), attribution: true });
    expect(css).toContain(
      '.et-src { opacity: 0.8 !important; color: #555555 !important; font-size: 90% !important; font-style: italic !important; font-family: "Literata", serif !important; }',
    );
    expect(css).toContain(
      '.et-tr { color: #123456 !important; font-family: "Noto Sans", sans-serif !important; font-weight: bold !important; font-size: 110% !important; }',
    );
    expect(css).toContain('.et-src, .et-tr { margin-top: 1em !important; margin-bottom: 1em !important; }');
    expect(css).toContain('ruby.et-ww > rt { font-size: 100% !important; font-style: normal; font-weight: normal; color: #abcdef !important; }');
    expect(css).toContain('.et-ww-p { line-height: 2.4; }');
    expect(css).toContain('.et-attr {');
    expect(css).not.toMatch(/background/i);
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls).toEqual(['literata', 'noto-sans'].flatMap((f) => ['regular', 'italic', 'bold'].map((w) => `epubtrans-fonts/${f}-${w}.ttf`)));
  });

  it('embeds only the fonts the mode shows', () => {
    const style: ExportStyle = { source: { font: 'literata' }, translation: { font: 'noto-serif' } };
    expect(embeddedFontsFor(style, 'bilingual').map((f) => f.id)).toEqual(['literata', 'noto-serif']);
    expect(embeddedFontsFor(style, 'translation-only').map((f) => f.id)).toEqual(['noto-serif']);
    expect(embeddedFontsFor(style, 'original')).toEqual([]);
    expect(embeddedFontsFor({ source: { font: 'serif' } }, 'bilingual')).toEqual([]);
  });
});

describe('exportEpub with an export style', () => {
  it('writes the style into epubtrans.css only, never as inline styles', async () => {
    const project = await translatedBook();
    const plain = await exportEpub(project, 'bilingual', env);
    const styled = await exportEpub(withStyle(project, { source: { color: '#333', italic: true }, translation: { fontWeight: 700 } }), 'bilingual', env);
    expect(cssOf(plain)).toBe(LEGACY_CSS);
    expect(cssOf(styled)).toContain('color: #333333');
    const files = readZip(styled);
    for (const [path, data] of readZip(plain)) {
      if (!path.endsWith('.xhtml')) continue;
      expect(new TextDecoder().decode(files.get(path)), path).toBe(new TextDecoder().decode(data));
    }
  });

  it('rejects an invalid style even when it bypassed validation', async () => {
    const project = await translatedBook();
    const bad = withStyle(project, { source: { color: '#fff} body { background: red' } } as ExportStyle);
    await expect(exportEpub(bad, 'bilingual', env)).rejects.toThrow(ExportStyleError);
  });

  it('marks translation-only blocks and links the stylesheet when the translation is styled', async () => {
    const project = await translatedBook();
    const out = await exportEpub(withStyle(project, { translation: { fontSizePercent: 120 } }), 'translation-only', env);
    expect(cssOf(out)).toContain('.et-tr { font-size: 120% !important; }');
    const chapter = project.chapters[2]?.href as string;
    const html = unzipText(out, chapter);
    expect(html).toContain('class="et-tr"');
    expect(html).toContain('epubtrans.css');
    // Without a translation style, translation-only stays as before: no class, no stylesheet.
    const plain = await exportEpub(withStyle(project, { source: { italic: true } }), 'translation-only', env);
    expect([...readZip(plain).keys()].some((k) => k.endsWith('epubtrans.css'))).toBe(false);
  });
});

describe('embedded fonts', () => {
  it('the catalog matches the committed files (sizes, TrueType magic, licenses)', () => {
    const dir = fileURLToPath(new URL('../data/fonts/', import.meta.url));
    for (const font of EMBEDDED_FONTS) {
      for (const face of font.faces) {
        expect(statSync(`${dir}${face.file}`).size, face.file).toBe(face.bytes);
        expect(Array.from(readFileSync(`${dir}${face.file}`).subarray(0, 4))).toEqual([0, 1, 0, 0]);
      }
      expect(statSync(`${dir}${font.licenseFile}`).size).toBe(font.licenseBytes);
      expect(readFileSync(`${dir}${font.licenseFile}`, 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
    expect(EMBEDDED_FONT_FILES).toHaveLength(EMBEDDED_FONTS.length * 4);
    expect(embeddedFontsSize([EMBEDDED_FONTS[0] as (typeof EMBEDDED_FONTS)[number]])).toBe(95_372 + 94_920 + 98_100 + 4_389);
  });

  it('packages font files and licenses with manifest items (EPUB 3: font/ttf)', async () => {
    const project = withStyle(await translatedBook(), { source: { font: 'literata' }, translation: { font: 'be-vietnam-pro' } });
    const out = await exportEpub(project, 'bilingual', env, { loadFontFile });
    const files = readZip(out);
    expect(files.get('OEBPS/epubtrans-fonts/literata-regular.ttf')?.byteLength).toBe(95_372);
    expect(files.has('OEBPS/epubtrans-fonts/literata-OFL.txt')).toBe(true);
    expect(files.has('OEBPS/epubtrans-fonts/be-vietnam-pro-bold.ttf')).toBe(true);
    expect(files.has('META-INF/encryption.xml')).toBe(false);
    const opf = unzipText(out, 'OEBPS/content.opf');
    expect(opf).toMatch(/<item[^>]*media-type="font\/ttf"[^>]*href="epubtrans-fonts\/literata-regular.ttf"/);
    expect(opf).toMatch(/<item[^>]*media-type="text\/plain"[^>]*href="epubtrans-fonts\/literata-OFL.txt"/);
    expect(cssOf(out)).toContain(
      '@font-face { font-family: "Literata"; font-style: italic; font-weight: 400; src: url("epubtrans-fonts/literata-italic.ttf"); }',
    );
    // Fonts the mode does not show are not packaged.
    const original = readZip(await exportEpub(project, 'original', env, { loadFontFile }));
    expect([...original.keys()].some((k) => k.includes('epubtrans-fonts'))).toBe(false);
  });

  it('uses the EPUB 2 font media type in EPUB 2 packages', async () => {
    const project = withStyle(await translatedBook(buildEpub2Book(), 'b.epub'), { translation: { font: 'noto-serif' } });
    const out = await exportEpub(project, 'bilingual', env, { loadFontFile });
    expect(unzipText(out, 'OEBPS/content.opf')).toMatch(/media-type="application\/x-font-truetype"[^>]*href="epubtrans-fonts\/noto-serif-regular.ttf"/);
  });

  it('fails clearly without a loader or with something that is not a font', async () => {
    const project = withStyle(await translatedBook(), { translation: { font: 'noto-sans' } });
    await expect(exportEpub(project, 'bilingual', env)).rejects.toThrow(/Noto Sans/);
    const html = new TextEncoder().encode('<!doctype html><title>404</title>');
    await expect(exportEpub(project, 'bilingual', env, { loadFontFile: async () => html })).rejects.toThrow(/not a TrueType font/);
    const asked: string[] = [];
    await exportEpub(project, 'bilingual', env, {
      loadFontFile: async (file) => {
        asked.push(file);
        return loadFontFile(file);
      },
    });
    expect(asked.sort()).toEqual(['noto-sans-OFL.txt', 'noto-sans-bold.ttf', 'noto-sans-italic.ttf', 'noto-sans-regular.ttf']);
  });
});
