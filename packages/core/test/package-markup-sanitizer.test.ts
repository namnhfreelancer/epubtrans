import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { exportEpub, importBook } from '../src';
import { parsePackage } from '../src/epub/package-document';
import { markupKindOf } from '../src/export/markup-file-kind';
import { sanitizeMarkupFile, stripActiveContent } from '../src/export/strip-active-content';
import { readZip, writeEpubZip } from '../src/util/zip-archive';
import { ACTIVE, addManifestItems, browserLikeEnv, dec, editText, enc, expectNoActiveMarkup, poisonedProject } from './package-markup-test-helpers';
import { env, fakeTranslate, readFixture, unzipText } from './test-helpers';

const EMPTY_SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const MALFORMED_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>console.log("PWN")</script><g></svg>';
const MALFORMED_XHTML = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><p>kept text<script>alert(1)</script><br></body></html>';
const EMBEDS =
  '<iframe src="extra.html"/><object data="extra.svg" type="image/svg+xml"><p>fallback</p></object><embed src="extra.svg"/><applet code="x"/><frameset><frame src="extra.html"/></frameset>';

const xhtmlDoc = (body: string, ns = '') =>
  new env.DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"${ns}><head><title>t</title></head><body>${body}</body></html>`,
    'application/xhtml+xml',
  );

describe('stripActiveContent', () => {
  it('removes namespace-prefixed scripts and every embedding element', () => {
    const doc = xhtmlDoc(
      `<p>text</p><h:script>alert(1)</h:script><s:svg><s:script>alert(2)</s:script><s:rect/></s:svg>${EMBEDS}<h:iframe src="x.html"/>`,
      ' xmlns:h="http://www.w3.org/1999/xhtml" xmlns:s="http://www.w3.org/2000/svg"',
    );
    expect(stripActiveContent(doc)).toBe(true);
    const markup = String(doc.documentElement);
    expect(markup).not.toMatch(ACTIVE);
    expect(markup).toContain('<p>text</p>');
    expect(markup).toContain('rect');
  });

  it('removes templates, whose declarative shadow root would run their scripts', () => {
    const doc = xhtmlDoc(
      '<p>kept</p><template shadowrootmode="open"><script>alert(1)</script></template><h:template shadowroot="open"><p>x</p></h:template>',
      ' xmlns:h="http://www.w3.org/1999/xhtml"',
    );
    expect(stripActiveContent(doc)).toBe(true);
    const markup = String(doc.documentElement);
    expect(markup).not.toMatch(ACTIVE);
    expect(markup).toContain('<p>kept</p>');
  });

  it('unwraps <object> to its sanitized fallback content, dropping <param>', () => {
    const doc = xhtmlDoc(
      '<p>a</p><object data="fig.svg" type="image/svg+xml"><param name="p" value="v"/><img src="fig.png" alt="FIGURE-FALLBACK" onerror="alert(1)"/><script>alert(2)</script><object data="x.swf"><span>inner</span></object></object><p>b</p>',
    );
    expect(stripActiveContent(doc)).toBe(true);
    const markup = String(doc.documentElement);
    expect(markup).not.toMatch(ACTIVE);
    expect(markup).toMatch(/<p>a<\/p><img src="fig.png" alt="FIGURE-FALLBACK" ?\/><span>inner<\/span><p>b<\/p>/);
  });

  it('turns CDATA sections into escaped text, so an HTML parser cannot find markup in them', () => {
    const doc = xhtmlDoc('<p><![CDATA[x><script>alert(1)</script>]]></p>');
    stripActiveContent(doc);
    const markup = String(doc.documentElement);
    expect(markup).not.toMatch(ACTIVE);
    expect(markup).toContain('x&gt;&lt;script&gt;');
  });
});

describe('markupKindOf', () => {
  it.each([
    ['a/b.xhtml', 'application/xhtml+xml', 'xhtml'],
    ['a/b.html', 'text/html', 'xhtml'],
    ['a/extra.htm', undefined, 'xhtml'],
    ['a/extra.xht', undefined, 'xhtml'],
    ['a/img.svg', 'image/svg+xml', 'svg'],
    ['a/IMG.SVG', undefined, 'svg'],
    ['a/data.xml', undefined, 'xml'],
    ['a/toc.ncx', 'application/x-dtbncx+xml', 'xml'],
    ['a/disguised.html', 'image/png', 'xhtml'],
    ['a/page.shtml', 'image/png', 'xhtml'],
    ['a/page.SHTM', undefined, 'xhtml'],
    ['a/page.htm', 'image/svg+xml', 'xhtml'],
    ['a/z.dat', 'application/xhtml+xml; charset=utf-8', 'xhtml'],
    ['a/z.dat', ' Text/HTML ;charset=utf-8', 'xhtml'],
    ['a/z.dat', 'IMAGE/SVG+XML; charset=utf-8', 'svg'],
    ['a/z.dat', 'application/xml;x=y', 'xml'],
    ['a/b.xhtml', 'image/svg+xml', 'svg'],
    ['a/style.css', 'text/css', undefined],
    ['a/cover.jpg', 'image/jpeg', undefined],
  ] as const)('%s (%s) is %s', (path, mediaType, kind) => {
    expect(markupKindOf(path, mediaType)).toBe(kind);
  });
});

describe('sanitizeMarkupFile with a browser-like strict XML parser', () => {
  it('replaces malformed SVG with an empty SVG', () => {
    const result = sanitizeMarkupFile(browserLikeEnv, 'svg', MALFORMED_SVG);
    expect(result?.text).toBe(`<?xml version="1.0" encoding="utf-8"?>\n${EMPTY_SVG_TEXT}\n`);
  });

  it('rebuilds malformed XHTML as well-formed XHTML without scripts, keeping its text', () => {
    const result = sanitizeMarkupFile(browserLikeEnv, 'xhtml', MALFORMED_XHTML);
    expect(result?.text).not.toMatch(ACTIVE);
    expect(result?.text).toContain('kept text');
    expect(XMLValidator.validate(result?.text ?? '')).toBe(true);
  });

  it('replaces malformed generic XML with an empty stand-in', () => {
    const result = sanitizeMarkupFile(browserLikeEnv, 'xml', '<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)<a>');
    expect(result?.text).toBe('<?xml version="1.0" encoding="utf-8"?>\n<removed/>\n');
  });

  it('leaves clean SVG and XML untouched', () => {
    expect(sanitizeMarkupFile(browserLikeEnv, 'svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect onlyclass="x"/></svg>')).toBeDefined();
    expect(sanitizeMarkupFile(browserLikeEnv, 'svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>')).toBeUndefined();
    expect(sanitizeMarkupFile(browserLikeEnv, 'xml', '<container><rootfile full-path="a.opf"/></container>')).toBeUndefined();
  });

  it.each([
    ['xml', '<script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>', '<removed/>'],
    ['svg', '<h:object xmlns:h="http://www.w3.org/1999/xhtml" data="x.svg"><h:p>x</h:p></h:object>', EMPTY_SVG_TEXT],
  ] as const)('replaces %s whose root element is active content with an empty stand-in', (kind, markup, standIn) => {
    for (const domEnv of [env, browserLikeEnv]) expect(sanitizeMarkupFile(domEnv, kind, markup)?.text).toContain(standIn);
  });

  it.each([
    ['xml', '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="x.xsl"?>\n<doc><p>kept</p></doc>'],
    ['svg', '<?xml-stylesheet type="application/xslt+xml" href="x.xsl"?><svg xmlns="http://www.w3.org/2000/svg"><text>kept</text></svg>'],
    [
      'xhtml',
      '<?xml-stylesheet type="text/xsl" href="x.xsl"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>kept</p></body></html>',
    ],
  ] as const)('drops XSL xml-stylesheet instructions from %s', (kind, markup) => {
    for (const domEnv of [env, browserLikeEnv]) {
      const result = sanitizeMarkupFile(domEnv, kind, markup);
      expect(result?.text).not.toMatch(ACTIVE);
      expect(result?.text).toContain('kept');
    }
  });
});

describe('export sanitizes every markup file of the source package', () => {
  it('removes prefixed scripts and embedding elements from documents that are not chapters', async () => {
    const project = await poisonedProject((files) =>
      editText(files, 'OEBPS/wrap0000.xhtml', (s) =>
        s.replace(
          '</body>',
          `<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script><svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(2)</svg:script></svg:svg>${EMBEDS}</body>`,
        ),
      ),
    );
    expect(project.chapters.some((c) => c.href === 'OEBPS/wrap0000.xhtml')).toBe(false);
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      const wrap = unzipText(out, 'OEBPS/wrap0000.xhtml');
      expect(wrap).toContain('4801362310348186356_cover.jpg');
    }
  });

  it('removes embedding elements from chapters', async () => {
    const chapter = 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml';
    const project = await poisonedProject((files) => editText(files, chapter, (s) => s.replace('</body>', `${EMBEDS}</body>`)));
    const out = await exportEpub(project, 'bilingual', env);
    expectNoActiveMarkup(out);
    expect(unzipText(out, chapter)).toContain('[vi] ');
  });

  it('neutralizes malformed SVG and XHTML manifest items', async () => {
    const project = await poisonedProject((files) => {
      files.set('OEBPS/bad.svg', enc(MALFORMED_SVG));
      files.set('OEBPS/bad.xhtml', enc(MALFORMED_XHTML));
      addManifestItems(
        files,
        '<item href="bad.svg" id="bad-svg" media-type="image/svg+xml" properties="scripted"/><item href="bad.xhtml" id="bad-xhtml" media-type="application/xhtml+xml" properties="scripted"/>',
      );
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      expect(unzipText(out, 'OEBPS/bad.xhtml')).toContain('kept text');
      expect(XMLValidator.validate(unzipText(out, 'OEBPS/bad.xhtml'))).toBe(true);
      expect(XMLValidator.validate(unzipText(out, 'OEBPS/bad.svg'))).toBe(true);
      expect(unzipText(out, 'OEBPS/content.opf')).not.toContain('scripted');
    }
    const strictOut = await exportEpub(project, 'bilingual', browserLikeEnv);
    expect(unzipText(strictOut, 'OEBPS/bad.svg')).toContain('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('drops files the OPF does not reference, sanitizes META-INF markup, and keeps other files as they are', async () => {
    const source = readZip(readFixture('a-modest-proposal.epub'));
    const stray = ['OEBPS/extra.html', 'OEBPS/extra.svg', 'OEBPS/extra.xml', 'OEBPS/disguised.css.html', 'OEBPS/y.shtml', 'y.bin', 'OEBPS/x.xsl'];
    const project = await poisonedProject((files) => {
      files.set('OEBPS/extra.html', enc('<html><body><p>side</p><script>alert(1)</script></body></html>'));
      files.set('OEBPS/extra.svg', enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(3)"><circle r="1"/></svg>'));
      files.set('OEBPS/extra.xml', enc('<doc><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(4)</h:script></doc>'));
      files.set('OEBPS/disguised.css.html', enc('<p onclick="alert(5)">x</p>'));
      files.set('OEBPS/y.shtml', enc('<p>x</p><script>console.log("PWN-shtml")</script>'));
      files.set('y.bin', enc('<script>alert(6)</script>'));
      files.set('OEBPS/x.xsl', enc('<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"/>'));
      files.set('META-INF/extra.html', enc('<html><body><p>meta side</p><script>alert(7)</script></body></html>'));
    });
    const out = await exportEpub(project, 'bilingual', env);
    expectNoActiveMarkup(out);
    const files = readZip(out);
    for (const path of stray) expect(files.has(path), path).toBe(false);
    expect(dec(files.get('META-INF/extra.html') ?? new Uint8Array())).toContain('meta side');
    for (const path of ['META-INF/container.xml', 'OEBPS/pgepub.css', 'OEBPS/4801362310348186356_cover.jpg']) {
      expect(files.get(path), path).toEqual(source.get(path));
    }
  });

  it('keeps local targets of OPF <link> elements', async () => {
    const project = await poisonedProject((files) => {
      files.set('OEBPS/record.xml', enc('<record><title>kept</title></record>'));
      editText(files, 'OEBPS/content.opf', (s) => s.replace('</metadata>', '<link rel="record" href="record.xml" media-type="application/xml"/></metadata>'));
    });
    const out = await exportEpub(project, 'bilingual', env);
    expect(unzipText(out, 'OEBPS/record.xml')).toContain('kept');
  });

  it('sanitizes manifest items whose media type has parameters or unusual case', async () => {
    const project = await poisonedProject((files) => {
      files.set(
        'OEBPS/z.dat',
        enc('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>z</title></head><body><p>zed</p><script>console.log("PWN-dat")</script></body></html>'),
      );
      files.set('OEBPS/w.dat', enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="1"/></svg>'));
      addManifestItems(
        files,
        '<item href="z.dat" id="z" media-type="application/xhtml+xml; charset=utf-8"/><item href="w.dat" id="w" media-type=" Image/SVG+XML "/>',
      );
    });
    const out = await exportEpub(project, 'bilingual', env);
    expectNoActiveMarkup(out);
    expect(unzipText(out, 'OEBPS/z.dat')).toContain('zed');
    expect(unzipText(out, 'OEBPS/w.dat')).toContain('<circle');
  });

  it('removes templates from an HTML manifest item and from documents that are not chapters', async () => {
    const dsd = '<template shadowrootmode="open"><script>console.log("PWN-dsd")</script></template>';
    const project = await poisonedProject((files) => {
      files.set('OEBPS/dsd.html', enc(`<!DOCTYPE html><html><head><title>d</title></head><body><p>dsd text</p>${dsd}</body></html>`));
      addManifestItems(files, '<item href="dsd.html" id="dsd" media-type="text/html"/>');
      editText(files, 'OEBPS/wrap0000.xhtml', (s) => s.replace('</body>', `${dsd}</body>`));
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      expect(unzipText(out, 'OEBPS/dsd.html')).toContain('dsd text');
    }
  });

  it('strips XSL xml-stylesheet instructions and removes XSLT stylesheets with their manifest items', async () => {
    const pi = '<?xml-stylesheet type="text/xsl" href="x.xsl"?>';
    const project = await poisonedProject((files) => {
      files.set('OEBPS/x.xml', enc(`<?xml version="1.0"?>\n${pi}\n<doc><p>xml text</p></doc>`));
      files.set('OEBPS/x.svg', enc(`<?xml version="1.0"?>\n${pi}\n<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>`));
      files.set('OEBPS/x.xsl', enc('<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"/>'));
      files.set('OEBPS/t.xml', enc('<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"/>'));
      editText(files, 'OEBPS/wrap0000.xhtml', (s) => s.replace(/^(?:\s*<\?xml [^>]*\?>)?/, (decl) => `${decl}${pi}`));
      addManifestItems(
        files,
        '<item href="x.xml" id="x-xml" media-type="application/xml"/><item href="x.svg" id="x-svg" media-type="image/svg+xml"/><item href="x.xsl" id="x-xsl" media-type="application/xslt+xml"/><item href="t.xml" id="t-xsl" media-type="text/xsl; charset=utf-8"/>',
      );
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      const files = readZip(out);
      expect(files.has('OEBPS/x.xsl')).toBe(false);
      expect(files.has('OEBPS/t.xml')).toBe(false);
      expect(unzipText(out, 'OEBPS/x.xml')).toContain('xml text');
      expect(unzipText(out, 'OEBPS/x.svg')).toContain('<circle');
      const opf = unzipText(out, 'OEBPS/content.opf');
      expect(opf).not.toContain('x-xsl');
      expect(opf).not.toContain('t-xsl');
      expect(opf).toContain('x-xml');
    }
  });

  it('keeps the fallback image of an <object> in a chapter', async () => {
    const chapter = 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml';
    const project = await poisonedProject((files) =>
      editText(files, chapter, (s) =>
        s.replace(
          '</body>',
          '<object data="4801362310348186356_cover.jpg" type="image/jpeg"><param name="p" value="v"/><img src="4801362310348186356_cover.jpg" alt="FIGURE-FALLBACK"/></object></body>',
        ),
      ),
    );
    const out = await exportEpub(project, 'bilingual', env);
    expectNoActiveMarkup(out);
    expect(unzipText(out, chapter)).toMatch(/<img src="4801362310348186356_cover.jpg" alt="FIGURE-FALLBACK" ?\/>/);
  });
});

describe('export keeps every file of a valid book', () => {
  it.each(['a-modest-proposal.epub', 'a-modest-proposal.mobi', 'a-modest-proposal.azw3', 'aesop-fables.fb2'])('%s', async (name) => {
    const project = await importBook(readFixture(name), name, env);
    const source = readZip(project.sourceEpub);
    const pkg = parsePackage(source, env);
    const out = readZip(await exportEpub(project, 'translation-only', env));
    for (const item of pkg.manifest) expect(out.has(item.path), item.path).toBe(source.has(item.path));
    expect([...source.keys()].filter((path) => !out.has(path))).toEqual([]);
  });
});

describe('content document doctype', () => {
  it('writes no HTML5 doctype into an EPUB 2 book, whose XHTML 1.1 documents forbid it', async () => {
    const files = readZip(readFixture('a-modest-proposal.epub'));
    const opf = new TextDecoder().decode(files.get('OEBPS/content.opf'));
    files.set('OEBPS/content.opf', enc(opf.replace(/(<package\b[^>]*\bversion=")3\.0"/, '$12.0"')));
    const project = await importBook(writeEpubZip(files), 'epub2.epub', env);
    for (const s of project.chapters.flatMap((c) => c.segments)) {
      s.translationHtml = fakeTranslate(s.sourceHtml);
      s.status = 'translated';
    }
    const out = readZip(await exportEpub(project, 'bilingual', env));
    const xhtml = [...out.keys()].filter((path) => path.endsWith('.xhtml'));
    expect(xhtml.length).toBeGreaterThan(2);
    for (const path of xhtml) expect(new TextDecoder().decode(out.get(path)), path).not.toMatch(/<!DOCTYPE html>/i);
  });

  it('writes no HTML5 doctype into EPUB 2 documents rewritten by the package sanitizer (manifest, sniffed, stylesheet PI)', async () => {
    const page = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
    const project = await poisonedProject((files) => {
      editText(files, 'OEBPS/content.opf', (opf) => opf.replace(/(<package\b[^>]*\bversion=")3\.0"/, '$12.0"'));
      files.set('OEBPS/extra.xhtml', enc(`<?xml-stylesheet type="text/css" href="a.css"?>${page('<p onclick="x()">extra</p><script>s()</script>')}`));
      files.set('OEBPS/legacy.xhtml', enc(`<!DOCTYPE html>${page('<p>legacy</p>')}`));
      files.set('OEBPS/sniffed.page', enc(page('<p>sniffed</p><script>s()</script>')));
      addManifestItems(
        files,
        '<item id="extra" href="extra.xhtml" media-type="application/xhtml+xml"/><item id="legacy" href="legacy.xhtml" media-type="application/xhtml+xml"/><item id="sniffed" href="sniffed.page" media-type="application/octet-stream"/>',
      );
    });
    const out = readZip(await exportEpub(project, 'bilingual', env));
    for (const path of ['OEBPS/extra.xhtml', 'OEBPS/legacy.xhtml']) {
      const text = dec(out.get(path) ?? new Uint8Array());
      expect(text, path).toContain('<html');
      expect(text, path).not.toMatch(/<!DOCTYPE/i);
    }
    expect(dec(out.get('OEBPS/extra.xhtml') ?? new Uint8Array())).toContain('<?xml-stylesheet type="text/css" href="a.css"?>');
    expect(dec(out.get('OEBPS/sniffed.page') ?? new Uint8Array())).not.toMatch(/<!DOCTYPE html>|<script/i);
    expectNoActiveMarkup(writeEpubZip(out));
  });

  it('keeps an explicit doctype, and HTML5 for EPUB 3', () => {
    const xhtml11 = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
    const body = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>x</p></body></html>';
    expect(sanitizeMarkupFile(env, 'xhtml', `${xhtml11}${body}`, { epub2: true })?.text).toContain(xhtml11);
    expect(sanitizeMarkupFile(env, 'xhtml', body, { epub2: true })?.text).not.toContain('<!DOCTYPE');
    expect(sanitizeMarkupFile(env, 'xhtml', body)?.text).toContain('<!DOCTYPE html>');
  });
});
