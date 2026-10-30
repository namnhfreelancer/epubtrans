import { unzlibSync } from 'fflate';
import { MOBI, type MobiBook, type MobiTocItem } from '../../third-party/foliate-js/mobi.js';
import { convertHtmlNodes } from '../dom/html-to-xhtml';
import { bodyOf, createXhtmlDocument, ensureStylesheet, parseHtmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName } from '../dom/xml-dom-helpers';
import { type BuiltChapter, buildEpubPackage, TEXT_DIR, type TocNode } from '../epub/build-epub-package';
import type { DomEnv } from '../types';
import { ResourceRegistry } from './resource-registry';

interface LoadedSection {
  sectionIndex: number;
  html: Document;
  stylesheets: string[];
}

type LinkTarget = { file: string; id?: string };

const chapterFileName = (i: number) => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
const toBytes = (data: ArrayBuffer | Uint8Array) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/** Converts a DRM-free MOBI (MOBI6) or AZW3/KF8 book into an EPUB 3 package. */
export async function mobiToEpub(bytes: Uint8Array, env: DomEnv): Promise<Uint8Array> {
  if (isDrmProtected(bytes)) throw new Error('This book is DRM-protected; only DRM-free books are supported');
  const parser = new MOBI({ unzlib: unzlibSync, DOMParser: env.DOMParser, XMLSerializer: env.XMLSerializer });
  const book = await parser.open(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const registry = new ResourceRegistry();
  const isKf8 = typeof book.loadFlow === 'function';
  const sections = isKf8 ? await loadKf8Sections(book, registry, env) : await loadMobi6Sections(book, registry, env);

  const fileBySection = new Map(sections.map((s, i) => [s.sectionIndex, chapterFileName(i)]));
  const docBySection = new Map(sections.map((s) => [s.sectionIndex, s.html]));
  const resolve = async (href: string): Promise<LinkTarget | undefined> => {
    const target = await book.resolveHref(href);
    const file = target ? fileBySection.get(target.index) : undefined;
    if (!target || !file) return undefined;
    const el = docBySection.get(target.index) ? target.anchor(docBySection.get(target.index) as Document) : null;
    if (!el) return { file };
    if (!el.getAttribute('id')) el.setAttribute('id', el.getAttribute('name') || `pos-${href.replace(/[^A-Za-z0-9]/g, '')}`);
    return { file, id: el.getAttribute('id') ?? undefined };
  };

  for (const [i, s] of sections.entries()) {
    for (const a of byLocalName(s.html, 'a')) {
      const href = a.getAttribute('href') ?? (a.getAttribute('filepos') ? `filepos:${a.getAttribute('filepos')}` : null);
      if (!href || !/^(filepos:|kindle:pos:)/.test(href)) continue;
      const target = await resolve(href).catch(() => undefined);
      if (!target) a.removeAttribute('href');
      else a.setAttribute('href', `${target.file === chapterFileName(i) ? '' : target.file}${target.id ? `#${target.id}` : ''}` || target.file);
    }
  }

  const toc = await buildToc(book.toc ?? [], resolve);
  const titleBySection = new Map<string, string>();
  for (const node of flatten(toc)) {
    const file = node.href.split('#')[0] ?? '';
    if (!titleBySection.has(file)) titleBySection.set(file, node.label);
  }

  const meta = book.metadata;
  const language = (Array.isArray(meta.language) ? meta.language[0] : meta.language) || undefined;
  const title = meta.title || 'Untitled';
  const chapters: BuiltChapter[] = sections.map((s, i) => {
    const fileName = chapterFileName(i);
    const doc = createXhtmlDocument(env, titleBySection.get(`${TEXT_DIR}/${fileName}`) ?? title, language);
    for (const href of s.stylesheets) ensureStylesheet(doc, href);
    const body = firstByLocalName(s.html, 'body');
    const nodes = body ? convertHtmlNodes(Array.from(body.childNodes), doc, { strict: true, usedIds: new Set() }) : [];
    for (const n of nodes) bodyOf(doc).appendChild(n);
    return { fileName, doc };
  });

  const coverIndex = book.mobi.headers.exth?.coverOffset;
  if (coverIndex !== undefined && coverIndex < 0xffffffff) {
    const data = await book.mobi.loadResource(coverIndex).catch(() => undefined);
    if (data) registry.add(`embed-${coverIndex}`, toBytes(data), undefined, true);
  }

  return buildEpubPackage(
    {
      metadata: { title, author: meta.author?.join(', ') || undefined, language, identifier: meta.identifier ? `mobi:${meta.identifier}` : undefined },
      chapters,
      resources: registry.resources,
      toc,
    },
    env,
  );
}

async function loadMobi6Sections(book: MobiBook, registry: ResourceRegistry, env: DomEnv): Promise<LoadedSection[]> {
  const out: LoadedSection[] = [];
  for (const [sectionIndex, section] of book.sections.entries()) {
    if (!section.loadText) continue;
    const html = parseHtmlDocument(env, await section.loadText());
    for (const img of byLocalName(html, 'img')) {
      const recindex = Number(img.getAttribute('recindex'));
      const data = recindex > 0 ? await book.mobi.loadResource(recindex - 1).catch(() => undefined) : undefined;
      const href = data ? registry.add(`embed-${recindex - 1}`, toBytes(data)) : undefined;
      if (href) img.setAttribute('src', href);
      else img.remove();
    }
    out.push({ sectionIndex, html, stylesheets: [] });
  }
  return out;
}

async function loadKf8Sections(book: MobiBook, registry: ResourceRegistry, env: DomEnv): Promise<LoadedSection[]> {
  const loadFlow = book.loadFlow?.bind(book);
  const replace = book.replaceResources?.bind(book);
  if (!loadFlow || !replace) throw new Error('Unsupported KF8 book structure');
  // Intercept foliate's resource hook: write resources into the package instead of blob URLs.
  book.loadResource = async (uri: string) => {
    const match = /kindle:(flow|embed):(\w+)(?:\?mime=([\w/+.-]+))?/.exec(uri);
    if (!match) return '';
    const [, kind, id32, mime] = match;
    const id = Number.parseInt(id32 ?? '', 32);
    const raw = kind === 'flow' ? await loadFlow(id) : toBytes(await book.mobi.loadResource(id - 1));
    if (!raw) return '';
    let data = toBytes(raw);
    if (mime === 'text/css' || mime === 'image/svg+xml') data = new TextEncoder().encode(await replace(book.mobi.decode(data)));
    return registry.add(kind === 'flow' ? `flow-${id}` : `embed-${id - 1}`, data, mime) ?? '';
  };
  const out: LoadedSection[] = [];
  for (const [sectionIndex, section] of book.sections.entries()) {
    if (!section.loadText) continue;
    const markup = await replace(await section.loadText());
    const html = parseHtmlDocument(env, markup);
    const stylesheets = byLocalName(html, 'link')
      .filter((l) => /stylesheet/i.test(l.getAttribute('rel') ?? '') && l.getAttribute('href'))
      .map((l) => l.getAttribute('href') as string);
    for (const img of byLocalName(html, 'img')) if (!img.getAttribute('src')) img.remove();
    out.push({ sectionIndex, html, stylesheets });
  }
  return out;
}

async function buildToc(items: MobiTocItem[], resolve: (href: string) => Promise<LinkTarget | undefined>): Promise<TocNode[]> {
  const out: TocNode[] = [];
  for (const item of items) {
    const target = await resolve(item.href).catch(() => undefined);
    const children = item.subitems?.length ? await buildToc(item.subitems, resolve) : [];
    if (!target) {
      out.push(...children);
      continue;
    }
    const href = `${TEXT_DIR}/${target.file}${target.id ? `#${target.id}` : ''}`;
    out.push({ label: item.label.trim() || target.file, href, children });
  }
  return out;
}

function flatten(nodes: TocNode[]): TocNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

/** MOBI header: encryption type at offset 12 of record 0 (non-zero means DRM). */
function isDrmProtected(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 86) return false;
  const record0 = view.getUint32(78);
  return record0 + 14 <= bytes.byteLength && view.getUint16(record0 + 12) !== 0;
}
