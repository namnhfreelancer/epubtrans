import { parseXhtmlDocument } from '../dom/xhtml-document';
import { byLocalName, elementChildren, firstByLocalName, getAttrLocal, isParserError, nameOf, parseXml, textOf } from '../dom/xml-dom-helpers';
import type { DomEnv } from '../types';
import { normalizeMediaType } from '../util/media-type';
import { decodeMarkup } from '../util/text-encoding';
import type { FileMap } from '../util/zip-archive';
import { dirname, resolvePath } from '../util/zip-path';

export interface ManifestItem {
  id: string;
  /** Full path inside the container. */
  path: string;
  mediaType: string;
  properties: string[];
}

export interface BookMetadata {
  title: string;
  author?: string;
  language?: string;
  identifier?: string;
}

export interface PackageInfo {
  opfPath: string;
  opf: Document;
  metadata: BookMetadata;
  manifest: ManifestItem[];
  spine: ManifestItem[];
  nav?: ManifestItem;
  ncx?: ManifestItem;
}

/** EPUB 2 package (XHTML 1.1 content documents: no `lang` attribute, no HTML5 doctype). */
export const isEpub2Package = (pkg: PackageInfo): boolean => (pkg.opf.documentElement.getAttribute('version') ?? '3').startsWith('2');

export function readText(files: FileMap, path: string): string {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Missing file in EPUB: ${path}`);
  return decodeMarkup(bytes);
}

export interface Rootfile {
  /** Full path inside the container. */
  path: string;
  mediaType: string;
}

const OPF_MEDIA_TYPE = 'application/oebps-package+xml';

/** Every rootfile META-INF/container.xml declares, in document order (the first is the primary rendition). */
export function readRootfiles(files: FileMap, env: DomEnv): Rootfile[] {
  const container = parseXml(env, readText(files, 'META-INF/container.xml'), 'META-INF/container.xml');
  return byLocalName(container, 'rootfile')
    .map((el) => ({ path: el.getAttribute('full-path') ?? '', mediaType: el.getAttribute('media-type') ?? '' }))
    .filter((r) => r.path !== '');
}

/** An absolute URL (`scheme:`) rather than a path inside the container. */
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z\d+.-]*:/;

/**
 * Local targets of the `<link>` elements of META-INF/container.xml, such as the rendition mapping
 * document of a multi-rendition EPUB, which no package manifest may list. Paths in container.xml
 * are relative to the container root; absolute URLs are left out.
 */
export function readContainerLinks(files: FileMap, env: DomEnv): string[] {
  const container = parseXml(env, readText(files, 'META-INF/container.xml'), 'META-INF/container.xml');
  return byLocalName(container, 'link')
    .map((el) => el.getAttribute('href') ?? '')
    .filter((href) => href !== '' && !ABSOLUTE_URL.test(href))
    .map((href) => resolvePath('', href))
    .filter(Boolean);
}

const ENCRYPTION_XML = 'META-INF/encryption.xml';

/**
 * Paths of the resources META-INF/encryption.xml lists (`CipherReference`, relative to the
 * container root): obfuscated fonts and other bytes that are not what they appear to be. Empty when
 * the file is missing or does not parse.
 */
export function readEncryptedPaths(files: FileMap, env: DomEnv): Set<string> {
  if (!files.has(ENCRYPTION_XML)) return new Set();
  const doc = new env.DOMParser().parseFromString(readText(files, ENCRYPTION_XML), 'application/xml');
  if (isParserError(doc)) return new Set();
  return new Set(
    byLocalName(doc, 'CipherReference')
      .map((el) => resolvePath('', el.getAttribute('URI') ?? ''))
      .filter(Boolean),
  );
}

/** Reads the OPF package document at `opfPath`, by default the primary rootfile of META-INF/container.xml. */
export function parsePackage(files: FileMap, env: DomEnv, opfPath = readRootfiles(files, env)[0]?.path): PackageInfo {
  if (!opfPath) throw new Error('container.xml does not declare a rootfile');
  const opf = parseXml(env, readText(files, opfPath), opfPath);
  const base = dirname(opfPath);

  const manifest: ManifestItem[] = byLocalName(opf, 'item').map((item) => ({
    id: item.getAttribute('id') ?? '',
    path: resolvePath(base, item.getAttribute('href') ?? ''),
    mediaType: item.getAttribute('media-type') ?? '',
    properties: (item.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
  }));
  const byId = new Map(manifest.map((m) => [m.id, m]));
  const spineEl = firstByLocalName(opf, 'spine');
  const spine = byLocalName(opf, 'itemref')
    .map((ref) => byId.get(ref.getAttribute('idref') ?? ''))
    .filter((m): m is ManifestItem => !!m && /html/.test(m.mediaType));
  const nav = manifest.find((m) => m.properties.includes('nav'));
  const ncx = byId.get(spineEl?.getAttribute('toc') ?? '') ?? manifest.find((m) => m.mediaType === 'application/x-dtbncx+xml');

  return { opfPath, opf, metadata: readMetadata(opf), manifest, spine, nav, ncx };
}

/**
 * Package documents of the renditions after the primary one (multi-rendition EPUBs). Rootfiles
 * that are not OPF (another media type), are missing, or do not parse are left out; callers that
 * keep files must still keep those rootfile paths (`readRootfiles`).
 */
export function parseOtherRenditions(files: FileMap, env: DomEnv, primary: PackageInfo): PackageInfo[] {
  const others: PackageInfo[] = [];
  for (const { path, mediaType } of readRootfiles(files, env)) {
    if (path === primary.opfPath || !files.has(path) || others.some((o) => o.opfPath === path)) continue;
    if (mediaType && normalizeMediaType(mediaType) !== OPF_MEDIA_TYPE) continue;
    if (isParserError(new env.DOMParser().parseFromString(readText(files, path), 'application/xml'))) continue;
    others.push(parsePackage(files, env, path));
  }
  return others;
}

function readMetadata(opf: Document): BookMetadata {
  const metadata = firstByLocalName(opf, 'metadata');
  const dc = (name: string) => (metadata ? byLocalName(metadata, name) : []);
  const creators = dc('creator');
  const author = creators.find((c) => getAttrLocal(c, 'role') === 'aut') ?? creators[0];
  return {
    title: textOf(dc('title')[0]),
    author: textOf(author) || undefined,
    language: textOf(dc('language')[0]) || undefined,
    identifier: textOf(dc('identifier')[0]) || undefined,
  };
}

/** Maps content-document path → first TOC label, from the nav document or the NCX. */
export function readTocLabels(files: FileMap, pkg: PackageInfo, env: DomEnv): Map<string, string> {
  const labels = new Map<string, string>();
  const add = (base: string, href: string | null, label: string) => {
    if (!href || !label) return;
    const path = resolvePath(base, href);
    if (!labels.has(path)) labels.set(path, label);
  };
  if (pkg.nav && files.has(pkg.nav.path)) {
    const doc = parseXhtmlDocument(env, readText(files, pkg.nav.path));
    const toc = byLocalName(doc, 'nav').find((n) => getAttrLocal(n, 'type') === 'toc') ?? byLocalName(doc, 'nav')[0];
    for (const a of toc ? byLocalName(toc, 'a') : []) add(dirname(pkg.nav.path), a.getAttribute('href'), textOf(a));
  } else if (pkg.ncx && files.has(pkg.ncx.path)) {
    const doc = parseXml(env, readText(files, pkg.ncx.path), pkg.ncx.path);
    for (const point of byLocalName(doc, 'navPoint')) {
      const label = textOf(elementChildren(point).find((c) => nameOf(c) === 'navlabel'));
      add(dirname(pkg.ncx.path), firstByLocalName(point, 'content')?.getAttribute('src') ?? null, label);
    }
  }
  return labels;
}
