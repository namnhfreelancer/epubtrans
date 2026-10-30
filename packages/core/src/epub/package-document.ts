import { parseXhtmlDocument } from '../dom/xhtml-document';
import { byLocalName, elementChildren, firstByLocalName, getAttrLocal, nameOf, parseXml, textOf } from '../dom/xml-dom-helpers';
import type { DomEnv } from '../types';
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

export function readText(files: FileMap, path: string): string {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Missing file in EPUB: ${path}`);
  return decodeMarkup(bytes);
}

/** Reads META-INF/container.xml and the OPF package document it points to. */
export function parsePackage(files: FileMap, env: DomEnv): PackageInfo {
  const container = parseXml(env, readText(files, 'META-INF/container.xml'), 'META-INF/container.xml');
  const opfPath = firstByLocalName(container, 'rootfile')?.getAttribute('full-path');
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
