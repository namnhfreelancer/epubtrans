import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { type DomEnv, exportEpub, importBook, type Project } from '../src';
import { markupKindOf, sanitizeMarkupFile, stripActiveContent } from '../src/export/strip-active-content';
import { type FileMap, readZip, writeEpubZip } from '../src/util/zip-archive';
import { env, fakeTranslate, readFixture, unzipText } from './test-helpers';

/** Any script vector or embedding element, with or without a namespace prefix. */
const ACTIVE = /<(?:[\w.-]+:)?(?:script|iframe|frame|frameset|object|embed|applet)\b|\son\w+=|javascript:|srcdoc/i;
const XML_MIMES = new Set(['application/xml', 'text/xml', 'application/xhtml+xml', 'image/svg+xml']);
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * Like Chromium's DOMParser: markup that is not well-formed XML yields a `parsererror` document
 * (linkedom parses it leniently instead).
 */
class StrictDOMParser {
  parseFromString(markup: string, mime: DOMParserSupportedType): Document {
    const parser = new env.DOMParser();
    if (XML_MIMES.has(mime) && XMLValidator.validate(markup) !== true) {
      return parser.parseFromString('<parsererror xmlns="http://www.w3.org/1999/xhtml">not well-formed</parsererror>', mime);
    }
    return parser.parseFromString(markup, mime);
  }
}
const browserLikeEnv: DomEnv = { ...env, DOMParser: StrictDOMParser as unknown as typeof globalThis.DOMParser };

const MALFORMED_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>console.log("PWN")</script><g></svg>';
const MALFORMED_XHTML = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><p>kept text<script>alert(1)</script><br></body></html>';
const EMBEDS =
  '<iframe src="extra.html"/><object data="extra.svg" type="image/svg+xml"><p>fallback</p></object><embed src="extra.svg"/><applet code="x"/><frameset><frame src="extra.html"/></frameset>';

async function poisonedProject(edit: (files: FileMap) => void): Promise<Project> {
  const project = await importBook(readFixture('a-modest-proposal.epub'), 'a.epub', env);
  const files = readZip(project.sourceEpub);
  edit(files);
  project.sourceEpub = writeEpubZip(files);
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = fakeTranslate(s.sourceHtml);
    s.status = 'translated';
  }
  return project;
}

function editText(files: FileMap, path: string, fn: (s: string) => string): void {
  const data = files.get(path);
  if (!data) throw new Error(`fixture changed: ${path}`);
  files.set(path, enc(fn(dec(data))));
}

function addManifestItems(files: FileMap, items: string): void {
  editText(files, 'OEBPS/content.opf', (s) => s.replace('</manifest>', `${items}</manifest>`));
}

function expectNoActiveMarkup(out: Uint8Array): void {
  for (const [name, data] of readZip(out)) {
    if (/\.(?:x?html?|svg|xml)$/.test(name)) expect(dec(data), name).not.toMatch(ACTIVE);
  }
}

describe('stripActiveContent', () => {
  it('removes namespace-prefixed scripts and every embedding element', () => {
    const doc = new env.DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:s="http://www.w3.org/2000/svg"><head><title>t</title></head><body><p>text</p><h:script>alert(1)</h:script><s:svg><s:script>alert(2)</s:script><s:rect/></s:svg>${EMBEDS}<h:iframe src="x.html"/></body></html>`,
      'application/xhtml+xml',
    );
    expect(stripActiveContent(doc)).toBe(true);
    const markup = String(doc.documentElement);
    expect(markup).not.toMatch(ACTIVE);
    expect(markup).toContain('<p>text</p>');
    expect(markup).toContain('rect');
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
    ['a/style.css', 'text/css', undefined],
    ['a/cover.jpg', 'image/jpeg', undefined],
  ] as const)('%s (%s) is %s', (path, mediaType, kind) => {
    expect(markupKindOf(path, mediaType)).toBe(kind);
  });
});

describe('sanitizeMarkupFile with a browser-like strict XML parser', () => {
  it('replaces malformed SVG with an empty SVG', () => {
    const result = sanitizeMarkupFile(browserLikeEnv, 'svg', MALFORMED_SVG);
    expect(result?.text).toBe('<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>\n');
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

  it('sanitizes HTML, SVG and XML files the manifest does not reference, and keeps other files as they are', async () => {
    const source = readZip(readFixture('a-modest-proposal.epub'));
    const project = await poisonedProject((files) => {
      files.set('OEBPS/extra.html', enc('<html><body><p>side</p><script>alert(1)</script><img src="x" onerror="alert(2)"></body></html>'));
      files.set('OEBPS/extra.svg', enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(3)"><circle r="1"/></svg>'));
      files.set('OEBPS/extra.xml', enc('<doc><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(4)</h:script></doc>'));
      files.set('OEBPS/disguised.css.html', enc('<p onclick="alert(5)">x</p>'));
    });
    const out = await exportEpub(project, 'bilingual', env);
    expectNoActiveMarkup(out);
    const files = readZip(out);
    expect(dec(files.get('OEBPS/extra.html') ?? new Uint8Array())).toContain('side');
    expect(dec(files.get('OEBPS/extra.svg') ?? new Uint8Array())).toContain('<circle');
    for (const path of ['META-INF/container.xml', 'OEBPS/pgepub.css', 'OEBPS/4801362310348186356_cover.jpg']) {
      expect(files.get(path), path).toEqual(source.get(path));
    }
  });
});
