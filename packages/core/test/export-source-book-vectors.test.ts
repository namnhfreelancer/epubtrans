import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportEpub, importBook } from '../src';
import { sniffMarkupKind, startsWithMarkup } from '../src/export/markup-file-kind';
import { sanitizeMarkupFile, stripActiveContent } from '../src/export/strip-active-content';
import { cssStylesheetInstruction, cssStylesheetInstructions } from '../src/export/xml-prolog';
import { readZip } from '../src/util/zip-archive';
import { addManifestItems, browserLikeEnv, dec, editText, enc, expectNoActiveMarkup, poisonedProject } from './package-markup-test-helpers';
import { env, fakeTranslate, loadFontFile, readFixture, unzipText } from './test-helpers';

const CHAPTER = 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml';
const RAW_TEXT_ELEMENTS = ['style', 'title', 'noscript', 'textarea', 'xmp', 'noembed'];
const htmlPage = (head: string, body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>${head}</head><body>${body}</body></html>`;
/** Elements an HTML parser would create with an event handler when it reads the markup. */
const liveHandlers = (markup: string) => new env.DOMParser().parseFromString(markup, 'text/html').querySelectorAll('[onerror]').length;

describe('comments cannot smuggle markup out of raw-text elements', () => {
  const payload = (el: string) => `<${el}><!--</${el}><img src="nx" onerror="console.log('PWN-${el}')"/>--></${el}>`;

  it('stripActiveContent removes comments inside the document element', () => {
    const doc = new env.DOMParser().parseFromString(htmlPage(payload('style'), '<p>kept<!-- note --></p>'), 'application/xhtml+xml');
    stripActiveContent(doc);
    const markup = String(doc.documentElement);
    expect(markup).not.toContain('<!--');
    expect(markup).toContain('<p>kept</p>');
  });

  it('removes them from an .html manifest item and from chapters', async () => {
    const page = htmlPage(
      payload('style'),
      RAW_TEXT_ELEMENTS.filter((el) => el !== 'style')
        .map(payload)
        .join(''),
    );
    // The repro is real: an HTML parser reading the source file creates the event handler.
    expect(liveHandlers(page)).toBeGreaterThan(0);
    const project = await poisonedProject((files) => {
      files.set('OEBPS/c-style.html', enc(page));
      addManifestItems(files, '<item href="c-style.html" id="c-style" media-type="application/xhtml+xml"/>');
      editText(files, CHAPTER, (s) => s.replace('</body>', `<!-- chapter comment --></body>`));
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      for (const path of ['OEBPS/c-style.html', CHAPTER]) {
        const text = unzipText(out, path);
        expect(text, path).not.toContain('<!--');
        expect(liveHandlers(text), path).toBe(0);
      }
    }
  });
});

describe('markup is recognized by content', () => {
  const bom = (s: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...enc(s)]);
  const utf16 = (s: string, le: boolean) => {
    const out = [le ? 0xff : 0xfe, le ? 0xfe : 0xff];
    for (const c of s) out.push(...(le ? [c.charCodeAt(0), 0] : [0, c.charCodeAt(0)]));
    return new Uint8Array(out);
  };

  it.each([
    ['plain tag', enc('<a/>'), true],
    ['leading whitespace', enc(' \t\r\n\f<?xml version="1.0"?><a/>'), true],
    ['UTF-8 BOM', bom('\n<html/>'), true],
    ['UTF-16LE BOM', utf16(' <a/>', true), true],
    ['UTF-16BE BOM', utf16('<a/>', false), true],
    ['CSS', enc('body { color: red }'), false],
    ['text before the tag', enc('x<a/>'), false],
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x3c]), false],
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x3c]), false],
    ['empty', new Uint8Array(), false],
    ['whitespace only', enc('  \n'), false],
  ])('%s → %s', (_, data, expected) => {
    expect(startsWithMarkup(data)).toBe(expected);
  });

  it.each([
    ['<?xml version="1.0"?>\n<!-- c --><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "x>y.dtd"><html/>', 'xhtml'],
    ['<h:HTML xmlns:h="http://www.w3.org/1999/xhtml"/>', 'xhtml'],
    ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'svg'],
    ['<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>', 'xml'],
    ['<!DOCTYPE html [<!ENTITY e "x">]><html/>', 'xml'],
    ['<p>x</p><script>alert(1)</script>', 'xml'],
  ] as const)('%s is sanitized as %s', (markup, kind) => {
    expect(sniffMarkupKind(markup)).toBe(kind);
  });

  it('sanitizes markup files with unknown extensions or non-markup media types, under META-INF too', async () => {
    const xhtm = htmlPage('', '<p>xhtm text</p><script>console.log("PWN-xhtm")</script>');
    const xsd =
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><h:script xmlns:h="http://www.w3.org/1999/xhtml">console.log("PWN-xsd")</h:script><xs:element name="kept"/></xs:schema>';
    const encryption =
      '<?xml version="1.0"?>\n<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/font.otf"/></enc:CipherData></enc:EncryptedData></encryption>';
    const project = await poisonedProject((files) => {
      files.set('OEBPS/a.xhtm', enc(xhtm));
      files.set('OEBPS/a.xsd', enc(xsd));
      files.set('OEBPS/m.dat', enc('<doc><script>console.log("PWN-dat")</script><a></doc>'));
      files.set('META-INF/x.xhtm', bom(`\n${xhtm}`));
      files.set('META-INF/y.xsd', enc(`  ${xsd}`));
      files.set('META-INF/encryption.xml', enc(encryption));
      addManifestItems(
        files,
        '<item href="a.xhtm" id="a-xhtm" media-type="image/png"/><item href="a.xsd" id="a-xsd" media-type="image/png"/><item href="m.dat" id="m-dat" media-type="application/octet-stream"/>',
      );
    });
    const source = readZip(project.sourceEpub);
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      const files = readZip(out);
      for (const path of ['OEBPS/a.xhtm', 'META-INF/x.xhtm']) expect(unzipText(out, path), path).toContain('xhtm text');
      for (const path of ['OEBPS/a.xsd', 'META-INF/y.xsd']) expect(unzipText(out, path), path).toContain('name="kept"');
      if (domEnv === browserLikeEnv) expect(unzipText(out, 'OEBPS/m.dat')).toContain('<removed/>');
      for (const path of ['META-INF/container.xml', 'META-INF/encryption.xml', 'OEBPS/pgepub.css', 'OEBPS/4801362310348186356_cover.jpg']) {
        expect(files.get(path), path).toEqual(source.get(path));
      }
    }
  });
});

describe('xml-stylesheet instructions', () => {
  it.each([
    [' type="text/css" href="a.css"', '<?xml-stylesheet type="text/css" href="a.css"?>'],
    ["\n href='a.css'\ttype='text/css' media='screen' ", '<?xml-stylesheet href="a.css" type="text/css" media="screen"?>'],
    [
      ` title='a "b"' type="text/css" href="a.css" alternate="no" charset="utf-8"`,
      '<?xml-stylesheet title="a &quot;b&quot;" type="text/css" href="a.css" alternate="no" charset="utf-8"?>',
    ],
    [` media=" type='text/css'" type="text/xsl" href="s.css"`, undefined],
    [` href="s.xml#a type='text/css'"`, undefined],
    [' type="text/xsl" href="x.xsl"', undefined],
    [' type="TEXT/CSS" href="a.css"', undefined],
    [' type="text/css; charset=utf-8" href="a.css"', undefined],
    [' type="text/css" type="text/xsl" href="a.css"', undefined],
    [' type="text/css" href="a.css" onload="x"', undefined],
    [' type="text/css" href="a&amp;b.css"', undefined],
    [' type="text/css" href="a<b.css"', undefined],
    [' type="text/css" href=" javascript:alert(1)"', undefined],
    [' type="text/css"href="a.css"', undefined],
    [' type="text/css" href="a.css" junk', undefined],
    [' type="text/css" href="a.css', undefined],
    [' type=text/css href="a.css"', undefined],
    [' type="text/css"', undefined],
    [' type="text/css" href=""', undefined],
    ['', undefined],
  ])('%j → %s', (data, expected) => {
    expect(cssStylesheetInstruction(data)).toBe(expected);
  });

  it('keeps only CSS instructions read from the prolog', () => {
    const css = '<?xml-stylesheet type="text/css" href="a.css"?>';
    expect(
      cssStylesheetInstructions(
        `﻿<?xml version="1.0"?>\n${css}<!-- <?xml-stylesheet type="text/css" href="c.css"?> --><?xml-stylesheet type="text/xsl" href="x.xsl"?><a>${css}</a>`,
      ),
    ).toEqual([css]);
    expect(cssStylesheetInstructions(`<!DOCTYPE a [<!ENTITY e "x">]>${css}<a/>`)).toEqual([]);
    expect(cssStylesheetInstructions(`<!DOCTYPE a SYSTEM "x>y">${css}<a/>`)).toEqual([css]);
    expect(cssStylesheetInstructions(`${css}<?xml-stylesheet href="b.css" type="text/css"`)).toEqual([css]);
  });

  it.each([
    ['xml', '<?xml version="1.0"?>\n<?xml-stylesheet media=" type=\'text/css\'" type="text/xsl" href="s.css"?>\n<doc><p>kept</p></doc>'],
    ['svg', '<?xml-stylesheet href="s.xml#a type=\'text/css\'"?><svg xmlns="http://www.w3.org/2000/svg"><text>kept</text></svg>'],
  ] as const)('rewrites %s that has a disguised XSL instruction', (kind, markup) => {
    for (const domEnv of [env, browserLikeEnv]) {
      const result = sanitizeMarkupFile(domEnv, kind, markup);
      expect(result?.text).not.toContain('xml-stylesheet');
      expect(result?.text).toContain('kept');
    }
  });

  it.each(['xml', 'svg', 'xhtml'] as const)('rewrites %s with a CSS instruction, keeping it', (kind) => {
    const root =
      kind === 'xhtml'
        ? htmlPage('', '<p>kept</p>').replace(/^<\?xml[^>]*>\n/, '')
        : kind === 'svg'
          ? '<svg xmlns="http://www.w3.org/2000/svg"><text>kept</text></svg>'
          : '<doc>kept</doc>';
    const markup = `<?xml version="1.0"?>\n<?xml-stylesheet type='text/css' href='a.css'?>\n<?xml-stylesheet type="text/xsl" href="x.xsl"?>\n${root}`;
    for (const domEnv of [env, browserLikeEnv]) {
      const text = sanitizeMarkupFile(domEnv, kind, markup)?.text ?? '';
      expect(text).toMatch(/^<\?xml version="1.0" encoding="utf-8"\?>\n<\?xml-stylesheet type="text\/css" href="a.css"\?>\n/);
      expect(text).not.toContain('text/xsl');
      expect(text).toContain('kept');
    }
  });

  it('export drops a disguised XSL instruction whose target is XSLT served as CSS', async () => {
    const project = await poisonedProject((files) => {
      files.set(
        'OEBPS/p2.xml',
        enc('<?xml version="1.0"?>\n<?xml-stylesheet media=" type=\'text/css\'" type="text/xsl" href="s.css"?>\n<doc><p>xml text</p></doc>'),
      );
      files.set(
        'OEBPS/s.css',
        enc(
          '<?xml version="1.0"?><xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"><xsl:template match="/"><xsl:element name="script">console.log("PWN-xslt-css")</xsl:element></xsl:template></xsl:stylesheet>',
        ),
      );
      addManifestItems(files, '<item href="p2.xml" id="p2" media-type="application/xml"/><item href="s.css" id="s-css" media-type="text/css"/>');
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      expect(unzipText(out, 'OEBPS/p2.xml')).not.toContain('xml-stylesheet');
      expect(unzipText(out, 'OEBPS/p2.xml')).toContain('xml text');
      // A CSS-typed resource is never applied as XSLT once the disguised instruction is gone: it stays as is.
      expect(readZip(out).get('OEBPS/s.css')).toEqual(readZip(project.sourceEpub).get('OEBPS/s.css'));
    }
  });
});

describe('multi-rendition books', () => {
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;
  const opf = (id: string, manifest: string, spine: string, links = '') =>
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${id}</dc:identifier><dc:title>Two renditions</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>${links}</metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`;
  const nav = xhtml('Contents', '<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>');
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="A/a.opf" media-type="application/oebps-package+xml"/><rootfile full-path="B/b.opf" media-type="application/oebps-package+xml"/><rootfile full-path="C/c.pdf" media-type="application/pdf"/><rootfile full-path="D/broken.opf" media-type="application/oebps-package+xml"/></rootfiles><links><link href="mapping.xhtml" rel="mapping" media-type="application/xhtml+xml"/><link href="https://example.com/x.xhtml" rel="mapping"/></links></container>`;
  const mapping = xhtml(
    'Renditions',
    '<nav epub:type="resource-map" onclick="alert(1)"><ul><li><a href="A/a.opf#epubcfi(/6/2)">a</a></li><li><a href="B/b.opf#epubcfi(/6/2)">b</a></li></ul></nav>',
  );

  function multiRenditionEpub(): Uint8Array {
    return zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'mapping.xhtml': strToU8(mapping),
      'A/a.opf': strToU8(
        opf(
          'a',
          '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
          '<itemref idref="c1"/>',
        ),
      ),
      'A/nav.xhtml': strToU8(nav),
      'A/c1.xhtml': strToU8(xhtml('One', '<p>Primary rendition text.</p>')),
      'B/b.opf': strToU8(
        opf(
          'b',
          '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" properties="scripted"/><item id="img" href="img/pic.dat" media-type="image/png"/><item id="xsl" href="t.xml" media-type="text/xsl" fallback="c1"/><item id="shared" href="../A/c1.xhtml" media-type="application/xhtml+xml"/>',
          '<itemref idref="c1"/><itemref idref="xsl"/>',
          '<link rel="record" href="record.xml" media-type="application/xml"/>',
        ),
      ),
      'B/nav.xhtml': strToU8(nav),
      'B/c1.xhtml': strToU8(xhtml('One', '<p onclick="alert(1)">Second rendition text.</p><script>console.log("PWN-rendition")</script>')),
      'B/img/pic.dat': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
      'B/t.xml': strToU8('<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"/>'),
      'B/record.xml': strToU8('<record><title>kept record</title></record>'),
      'B/stray.xhtml': strToU8(xhtml('Stray', '<p>stray</p>')),
      'C/c.pdf': strToU8('%PDF-1.4 fake'),
      'D/broken.opf': strToU8('<package><manifest><item href="lost.xhtml"></package>'),
      'D/lost.xhtml': strToU8(xhtml('Lost', '<p>lost</p>')),
    });
  }

  it('keeps every rendition and sanitizes the extra ones; translations apply to the primary one', async () => {
    const project = await importBook(multiRenditionEpub(), 'multi.epub', env);
    for (const s of project.chapters.flatMap((c) => c.segments)) {
      s.translationHtml = fakeTranslate(s.sourceHtml);
      s.status = 'translated';
    }
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      const files = readZip(out);
      for (const path of [
        'A/a.opf',
        'A/nav.xhtml',
        'A/c1.xhtml',
        'B/b.opf',
        'B/nav.xhtml',
        'B/c1.xhtml',
        'B/img/pic.dat',
        'B/record.xml',
        'C/c.pdf',
        'D/broken.opf',
        'mapping.xhtml',
      ]) {
        expect(files.has(path), path).toBe(true);
      }
      for (const path of ['B/t.xml', 'B/stray.xhtml']) expect(files.has(path), path).toBe(false);
      if (domEnv === browserLikeEnv) {
        // A rootfile that does not parse is kept (as a stand-in); the files only it could reference are not.
        expect(files.has('D/lost.xhtml')).toBe(false);
        expect(unzipText(out, 'D/broken.opf')).toContain('<removed/>');
      }
      expect(dec(files.get('META-INF/container.xml') ?? new Uint8Array())).toBe(container);
      // The rendition mapping document is linked from container.xml, never listed in a manifest.
      expect(unzipText(out, 'mapping.xhtml')).toContain('resource-map');
      expect(unzipText(out, 'A/c1.xhtml')).toContain('[vi] Primary rendition text.');
      const second = unzipText(out, 'B/c1.xhtml');
      expect(second).toContain('Second rendition text.');
      expect(second).not.toContain('[vi]');
      const secondOpf = unzipText(out, 'B/b.opf');
      expect(secondOpf).not.toContain('scripted');
      expect(secondOpf).not.toContain('t.xml');
      expect(secondOpf).not.toContain('idref="xsl"');
      expect(secondOpf).not.toContain('fallback');
      expect(secondOpf).toContain('record.xml');
      // It shares the translated A/c1.xhtml, which now links the bilingual stylesheet.
      expect(secondOpf).toContain('id="epubtrans-css"');
      expect(secondOpf).toContain('href="../A/epubtrans.css"');
      expect(unzipText(out, 'A/a.opf')).toContain('epubtrans-css');
      expect(unzipText(await exportEpub(project, 'translation-only', domEnv), 'B/b.opf')).not.toContain('epubtrans-css');
    }
  });

  it('a rendition sharing the styled stylesheet also lists its embedded fonts', async () => {
    const project = await importBook(multiRenditionEpub(), 'multi.epub', env);
    for (const s of project.chapters.flatMap((c) => c.segments)) {
      s.translationHtml = fakeTranslate(s.sourceHtml);
      s.status = 'translated';
    }
    project.settings = { ...project.settings, exportStyle: { translation: { font: 'literata' } } };
    const out = await exportEpub(project, 'bilingual', env, { loadFontFile });
    for (const [opfPath, href] of [
      ['A/a.opf', 'epubtrans-fonts/literata-regular.ttf'],
      ['B/b.opf', '../A/epubtrans-fonts/literata-regular.ttf'],
    ] as const) {
      expect(unzipText(out, opfPath), opfPath).toContain(`href="${href}"`);
    }
    expect(readZip(out).has('A/epubtrans-fonts/literata-OFL.txt')).toBe(true);
  });

  it('a single-rendition book exports exactly as before', async () => {
    const project = await importBook(readFixture('a-modest-proposal.epub'), 'a.epub', env);
    const source = readZip(project.sourceEpub);
    const out = readZip(await exportEpub(project, 'translation-only', env));
    expect([...out.keys()].sort()).toEqual([...source.keys()].sort());
    // Only the package document and the XHTML/NCX documents the export rebuilds may change.
    for (const [path, data] of source) if (!/\.(?:xhtml|ncx|opf)$/.test(path)) expect(out.get(path), path).toEqual(data);
  });
});
