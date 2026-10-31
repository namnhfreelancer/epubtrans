import { extractDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName, parseXml, textOf } from '../dom/xml-dom-helpers';
import { type PackageInfo, parsePackage, readText, readTocLabels } from '../epub/package-document';
import { isAttributionDocument } from '../export/attribution-page';
import { detectFormat } from '../formats/detect-format';
import { fb2ToEpub } from '../formats/fb2-to-epub';
import { mobiToEpub } from '../formats/mobi-to-epub';
import { createDefaultSettings } from '../project/default-settings';
import { segmentContentDocument, segmentNavDocument, segmentNcx } from '../segment/segment-document';
import type { Chapter, DomEnv, Project, Segment } from '../types';
import { randomId } from '../util/random-id';
import { encodeUtf8 } from '../util/text-encoding';
import { type FileMap, readZip, writeEpubZip } from '../util/zip-archive';
import { basename } from '../util/zip-path';

export const TOC_CHAPTER_TITLE = 'Table of Contents';

/**
 * Imports an EPUB, MOBI, AZW3 or FB2 book: detects the format, normalizes it into an EPUB
 * package, segments every spine document (plus the TOC) and returns a new project whose
 * `sourceEpub` carries the segment markers.
 */
export async function importBook(bytes: Uint8Array, fileName: string, env: DomEnv): Promise<Project> {
  const { format, bytes: data } = detectFormat(bytes, fileName);
  const epub = format === 'epub' ? data : format === 'fb2' ? fb2ToEpub(data, env) : await mobiToEpub(data, env);
  const files = readZip(epub);
  const encryption = files.has('META-INF/encryption.xml') ? readText(files, 'META-INF/encryption.xml') : '';
  if (files.has('META-INF/rights.xml') || (encryption && !isFontObfuscationOnly(encryption))) {
    throw new Error('This book is DRM-protected; only DRM-free books are supported');
  }
  const pkg = parsePackage(files, env);
  const chapters = segmentPackage(files, pkg, env);
  if (!chapters.some((c) => c.segments.length > 0)) throw new Error('No translatable text found in this book');
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomId(),
    title: pkg.metadata.title || fileName.replace(/\.[^.]+$/, ''),
    ...(pkg.metadata.author ? { author: pkg.metadata.author } : {}),
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings(),
    chapters,
    sourceEpub: writeEpubZip(files),
  };
}

/** Font obfuscation (IDPF/Adobe) is not DRM; anything else in encryption.xml is. */
function isFontObfuscationOnly(xml: string): boolean {
  const algorithms = [...xml.matchAll(/<(?:[\w-]+:)?EncryptionMethod[^>]*?Algorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1] ?? '');
  const obfuscation = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];
  return algorithms.every((a) => obfuscation.includes(a));
}

function segmentPackage(files: FileMap, pkg: PackageInfo, env: DomEnv): Chapter[] {
  const labels = readTocLabels(files, pkg, env);
  const chapters: Chapter[] = [];
  const add = (href: string, title: string, segments: Segment[]) => {
    if (segments.length) chapters.push({ href, title, segments });
  };
  const prefix = () => `c${chapters.length}-`;

  if (pkg.nav && files.has(pkg.nav.path)) {
    const markup = readText(files, pkg.nav.path);
    const doc = parseXhtmlDocument(env, markup);
    const segments = segmentNavDocument(doc, prefix());
    if (segments.length) files.set(pkg.nav.path, encodeUtf8(serializeXhtmlDocument(env, doc, extractDoctype(markup))));
    add(pkg.nav.path, TOC_CHAPTER_TITLE, segments);
  } else if (pkg.ncx && files.has(pkg.ncx.path)) {
    const doc = parseXml(env, readText(files, pkg.ncx.path), pkg.ncx.path);
    const segments = segmentNcx(doc, prefix());
    if (segments.length) files.set(pkg.ncx.path, encodeUtf8(serializeXmlDocument(env, doc)));
    add(pkg.ncx.path, TOC_CHAPTER_TITLE, segments);
  }

  for (const item of pkg.spine) {
    if (item.path === pkg.nav?.path || !files.has(item.path)) continue;
    const markup = readText(files, item.path);
    const doc = parseXhtmlDocument(env, markup);
    // The attribution page of an earlier epubtrans export is not book text: exporting again replaces it.
    if (isAttributionDocument(doc)) continue;
    const segments = segmentContentDocument(doc, prefix());
    if (!segments.length) continue;
    files.set(item.path, encodeUtf8(serializeXhtmlDocument(env, doc, extractDoctype(markup))));
    add(item.path, chapterTitle(doc, labels.get(item.path), item.path), segments);
  }
  return chapters;
}

function chapterTitle(doc: Document, tocLabel: string | undefined, path: string): string {
  if (tocLabel) return tocLabel;
  for (const tag of ['h1', 'h2', 'h3']) {
    const text = textOf(byLocalName(doc, tag)[0]);
    if (text) return text.slice(0, 120);
  }
  return textOf(firstByLocalName(doc, 'title')) || basename(path);
}
