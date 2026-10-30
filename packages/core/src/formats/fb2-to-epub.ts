import { bodyOf, createXhtmlDocument } from '../dom/xhtml-document';
import { byLocalName, elementChildren, firstByLocalName, getAttrLocal, nameOf, parseXml, textOf } from '../dom/xml-dom-helpers';
import { type BuiltChapter, buildEpubPackage, TEXT_DIR, type TocNode } from '../epub/build-epub-package';
import type { DomEnv } from '../types';
import { base64ToBytes } from '../util/media-type';
import { decodeMarkup } from '../util/text-encoding';
import { convertFb2Node, type Fb2ConvertContext } from './fb2-element-converter';
import { ResourceRegistry } from './resource-registry';

const chapterFileName = (i: number) => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;

/** Converts a FictionBook 2 document into an EPUB 3 package. */
export function fb2ToEpub(bytes: Uint8Array, env: DomEnv): Uint8Array {
  const fb2 = parseXml(env, decodeMarkup(bytes), 'FB2 document');
  const root = fb2.documentElement;
  if (nameOf(root) !== 'fictionbook') throw new Error('Not a FictionBook 2 document');

  const titleInfo = firstByLocalName(root, 'title-info');
  const title = textOf(titleInfo && firstByLocalName(titleInfo, 'book-title')) || 'Untitled';
  const language = textOf(titleInfo && firstByLocalName(titleInfo, 'lang')) || undefined;
  const authors = (titleInfo ? byLocalName(titleInfo, 'author') : []).map(personName).filter(Boolean);
  const docInfo = firstByLocalName(root, 'document-info');
  const identifier = textOf(docInfo && firstByLocalName(docInfo, 'id')) || undefined;

  const binaries = new Map(byLocalName(root, 'binary').map((b) => [b.getAttribute('id') ?? '', b]));
  const registry = new ResourceRegistry();
  const imageHref = (ref: string, isCover = false) => {
    const id = ref.startsWith('#') ? ref.slice(1) : '';
    const bin = binaries.get(id);
    if (!bin) return undefined;
    return registry.add(`img-${id}`, base64ToBytes(bin.textContent ?? ''), bin.getAttribute('content-type') ?? undefined, isCover);
  };
  const cover = titleInfo && firstByLocalName(titleInfo, 'coverpage');
  const coverImage = cover && firstByLocalName(cover, 'image');
  if (coverImage) imageHref(getAttrLocal(coverImage, 'href') ?? '', true);

  // One chapter per top-level section of the main body; leading title/epigraphs form their own chapter.
  const [mainBody, ...noteBodies] = elementChildren(root).filter((el) => nameOf(el) === 'body');
  if (!mainBody) throw new Error('FB2 document has no <body>');
  const groups: { nodes: Element[]; section?: Element }[] = [];
  let preface: Element[] = [];
  for (const child of elementChildren(mainBody)) {
    if (nameOf(child) === 'section') {
      if (preface.length) groups.push({ nodes: preface });
      preface = [];
      groups.push({ nodes: [child], section: child });
    } else preface.push(child);
  }
  if (preface.length) groups.push({ nodes: preface });
  for (const body of noteBodies) groups.push({ nodes: [body] });

  const usedIds = new Set<string>();
  const fileOfId = new Map<string, string>();
  const toc: TocNode[] = [];
  let anchorCounter = 0;
  const chapters: BuiltChapter[] = groups.map((group, i) => {
    const fileName = chapterFileName(i);
    const headTitle = group.section ? sectionTitle(group.section) : '';
    const doc = createXhtmlDocument(env, headTitle || title, language);
    const ctx: Fb2ConvertContext = { doc, depth: 0, usedIds, imageHref: (ref) => imageHref(ref) };
    for (const src of group.nodes) for (const n of convertFb2Node(src, ctx)) bodyOf(doc).appendChild(n);
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      const id = el.getAttribute('id');
      if (id) fileOfId.set(id, fileName);
    }
    if (group.section) {
      const sectionEl = firstByLocalName(bodyOf(doc), 'section');
      toc.push(...sectionToc(group.section, sectionEl, fileName, () => `toc-${anchorCounter++}`));
    } else if (group.nodes.length === 1 && nameOf(group.nodes[0] as Element) === 'body') {
      toc.push({ label: group.nodes[0]?.getAttribute('name') || 'Notes', href: `${TEXT_DIR}/${fileName}` });
    }
    return { fileName, doc };
  });

  // Internal links (`#id`) must point at the chapter file that now holds the id.
  for (const { fileName, doc } of chapters) {
    for (const a of byLocalName(doc, 'a')) {
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('#')) continue;
      const file = fileOfId.get(href.slice(1));
      if (!file) a.removeAttribute('href');
      else if (file !== fileName) a.setAttribute('href', `${file}${href}`);
    }
  }

  return buildEpubPackage(
    { metadata: { title, author: authors.join(', ') || undefined, language, identifier }, chapters, resources: registry.resources, toc },
    env,
  );
}

function personName(el: Element): string {
  const part = (n: string) => textOf(firstByLocalName(el, n));
  return part('nickname') || [part('first-name'), part('middle-name'), part('last-name')].filter(Boolean).join(' ');
}

function sectionTitle(section: Element): string {
  const title = elementChildren(section).find((c) => nameOf(c) === 'title');
  return title ? elementChildren(title).map(textOf).filter(Boolean).join(' ') : '';
}

/** TOC entries for a source section and its titled sub-sections, anchoring ids on the converted elements. */
function sectionToc(src: Element, out: Element | undefined, fileName: string, nextId: () => string): TocNode[] {
  const subSrc = elementChildren(src).filter((c) => nameOf(c) === 'section');
  const subOut = out ? elementChildren(out).filter((c) => nameOf(c) === 'section') : [];
  const children = subSrc.flatMap((s, i) => sectionToc(s, subOut[i], fileName, nextId));
  const label = sectionTitle(src);
  if (!label || !out) return children;
  if (!out.getAttribute('id')) out.setAttribute('id', nextId());
  return [{ label, href: `${TEXT_DIR}/${fileName}#${out.getAttribute('id')}`, children }];
}
