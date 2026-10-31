import { XMLValidator } from 'fast-xml-parser';
import { expect } from 'vitest';
import { type DomEnv, importBook, type Project } from '../src';
import { isNonMarkupPath, startsWithMarkup } from '../src/export/markup-file-kind';
import { cssStylesheetInstruction } from '../src/export/xml-prolog';
import { type FileMap, readZip, writeEpubZip } from '../src/util/zip-archive';
import { env, fakeTranslate, readFixture } from './test-helpers';

/** Any script vector, template or embedding element (with or without a namespace prefix), or XSL stylesheet. */
export const ACTIVE =
  /<(?:[\w.-]+:)?(?:script|template|iframe|frame|frameset|object|embed|applet|param)\b|\son\w+=|javascript:|srcdoc|<\?xml-stylesheet|<!\[CDATA\[/i;
const XML_MIMES = new Set(['application/xml', 'text/xml', 'application/xhtml+xml', 'image/svg+xml']);
export const enc = (s: string) => new TextEncoder().encode(s);
export const dec = (b: Uint8Array) => new TextDecoder().decode(b);

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
export const browserLikeEnv: DomEnv = { ...env, DOMParser: StrictDOMParser as unknown as typeof globalThis.DOMParser };

/** The fixture book with `edit` applied to its files and every segment translated by the echo translator. */
export async function poisonedProject(edit: (files: FileMap) => void): Promise<Project> {
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

export function editText(files: FileMap, path: string, fn: (s: string) => string): void {
  const data = files.get(path);
  if (!data) throw new Error(`fixture changed: ${path}`);
  files.set(path, enc(fn(dec(data))));
}

export function addManifestItems(files: FileMap, items: string): void {
  editText(files, 'OEBPS/content.opf', (s) => s.replace('</manifest>', `${items}</manifest>`));
}

/** Removes the CSS `xml-stylesheet` instructions the sanitizer writes itself (canonical form only). */
const withoutCanonicalCss = (text: string) =>
  text.replace(/<\?xml-stylesheet([\s\S]*?)\?>/g, (pi, data: string) => (cssStylesheetInstruction(data) === pi ? '' : pi));

/**
 * Every markup file of the export (by extension, or by content unless its extension marks a
 * non-markup resource such as CSS or a font) is free of active content.
 */
export function expectNoActiveMarkup(out: Uint8Array): void {
  for (const [name, data] of readZip(out)) {
    if (name === 'mimetype') continue;
    if (/\.(?:s?html?|xht(?:ml)?|svg|xml|ncx|dat|opf)$/.test(name) || (!isNonMarkupPath(name) && startsWithMarkup(data))) {
      expect(withoutCanonicalCss(dec(data)), name).not.toMatch(ACTIVE);
    }
  }
}
