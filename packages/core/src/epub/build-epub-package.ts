import { serializeXhtmlDocument } from '../dom/xhtml-document';
import { byLocalName } from '../dom/xml-dom-helpers';
import type { DomEnv } from '../types';
import { randomId } from '../util/random-id';
import { encodeUtf8, escapeXml } from '../util/text-encoding';
import { type FileMap, writeEpubZip } from '../util/zip-archive';
import type { BookMetadata } from './package-document';

/**
 * Builds a fresh EPUB 3 package (with EPUB 2 NCX fallback) from converted content.
 * Used to normalize MOBI/AZW3/FB2 input so every format shares one EPUB code path.
 * Layout: OEBPS/content.opf, OEBPS/nav.xhtml, OEBPS/toc.ncx, OEBPS/text/*, OEBPS/res/*.
 */
export const TEXT_DIR = 'text';
export const RES_DIR = 'res';

export interface BuiltChapter {
  /** File name inside OEBPS/text/. */
  fileName: string;
  doc: Document;
}

export interface BuiltResource {
  /** File name inside OEBPS/res/. */
  fileName: string;
  mediaType: string;
  data: Uint8Array;
  isCover?: boolean;
}

export interface TocNode {
  label: string;
  /** Relative to OEBPS/, e.g. `text/ch-001.xhtml#anchor`. */
  href: string;
  children?: TocNode[];
}

export interface BuildEpubInput {
  metadata: BookMetadata;
  chapters: BuiltChapter[];
  resources: BuiltResource[];
  toc: TocNode[];
}

export function buildEpubPackage(input: BuildEpubInput, env: DomEnv): Uint8Array {
  if (input.chapters.length === 0) throw new Error('Book has no readable content');
  const lang = input.metadata.language || 'und';
  const identifier = input.metadata.identifier || `urn:uuid:${randomId()}`;
  const toc = input.toc.length ? input.toc : input.chapters.map((c, i) => ({ label: `${i + 1}`, href: `${TEXT_DIR}/${c.fileName}` }));
  const files: FileMap = new Map();
  files.set('META-INF/container.xml', encodeUtf8(CONTAINER_XML));
  files.set('OEBPS/content.opf', encodeUtf8(buildOpf(input, identifier, lang)));
  files.set('OEBPS/nav.xhtml', encodeUtf8(buildNav(toc, lang)));
  files.set('OEBPS/toc.ncx', encodeUtf8(buildNcx(toc, input.metadata.title, identifier)));
  for (const c of input.chapters) files.set(`OEBPS/${TEXT_DIR}/${c.fileName}`, encodeUtf8(serializeXhtmlDocument(env, c.doc)));
  for (const r of input.resources) files.set(`OEBPS/${RES_DIR}/${r.fileName}`, r.data);
  return writeEpubZip(files);
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>
`;

function buildOpf(input: BuildEpubInput, identifier: string, lang: string): string {
  const { metadata, chapters, resources } = input;
  const modified = `${new Date().toISOString().slice(0, 19)}Z`;
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    ...chapters.map((c, i) => {
      const props = byLocalName(c.doc, 'svg').length ? ' properties="svg"' : '';
      return `<item id="c${i}" href="${TEXT_DIR}/${escapeXml(encodeURI(c.fileName))}" media-type="application/xhtml+xml"${props}/>`;
    }),
    ...resources.map((r, i) => {
      const props = r.isCover ? ' properties="cover-image"' : '';
      return `<item id="r${i}" href="${RES_DIR}/${escapeXml(encodeURI(r.fileName))}" media-type="${escapeXml(r.mediaType)}"${props}/>`;
    }),
  ];
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`);
  const author = metadata.author ? `<dc:creator>${escapeXml(metadata.author)}</dc:creator>` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${escapeXml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(metadata.title || 'Untitled')}</dc:title>
<dc:language>${escapeXml(lang)}</dc:language>
${author}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
${items.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`;
}

function buildNav(toc: TocNode[], lang: string): string {
  const list = (nodes: TocNode[]): string =>
    `<ol>${nodes
      .map((n) => `<li><a href="${escapeXml(n.href)}">${escapeXml(n.label || '-')}</a>${n.children?.length ? list(n.children) : ''}</li>`)
      .join('')}</ol>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1>${list(toc)}</nav></body></html>
`;
}

function buildNcx(toc: TocNode[], title: string, identifier: string): string {
  let order = 0;
  const points = (nodes: TocNode[]): string =>
    nodes
      .map((n) => {
        order++;
        return `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${escapeXml(n.label || '-')}</text></navLabel><content src="${escapeXml(n.href)}"/>${n.children?.length ? points(n.children) : ''}</navPoint>`;
      })
      .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${escapeXml(identifier)}"/></head><docTitle><text>${escapeXml(title || 'Untitled')}</text></docTitle><navMap>${points(toc)}</navMap></ncx>
`;
}
