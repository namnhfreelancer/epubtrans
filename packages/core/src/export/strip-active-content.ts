import { exportDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, CDATA_SECTION_NODE, COMMENT_NODE, ELEMENT_NODE, isParserError, nameOf, PROCESSING_INSTRUCTION_NODE } from '../dom/xml-dom-helpers';
import { isEpub2Package, type PackageInfo, readEncryptedPaths, readText } from '../epub/package-document';
import type { DomEnv } from '../types';
import { encodeUtf8 } from '../util/text-encoding';
import type { FileMap } from '../util/zip-archive';
import { isActiveAttribute } from './active-attributes';
import { isNonMarkupPath, type MarkupKind, markupKindOf, sniffMarkupKind, startsWithMarkup } from './markup-file-kind';
import { cssStylesheetInstructions, hasStylesheetInstruction } from './xml-prolog';

/**
 * Defense in depth for exported books: neither model output nor the source book may leave a
 * script vector in any markup file of the package. Removes `<script>`, `<template>` (declarative
 * shadow roots) and embedding elements (`iframe`, `embed`, ...) whatever their namespace prefix,
 * unwraps `<object>` to its fallback content, and removes event-handler (`on*`) and `srcdoc`
 * attributes and attributes carrying `javascript:`, `vbscript:` or HTML `data:` URLs.
 */

/**
 * Elements removed with their content: scripts, templates (an HTML parser attaches a
 * `shadowrootmode` template's content, scripts included, as a live shadow root) and elements that
 * embed another (unsanitized) document.
 */
const REMOVED_ELEMENTS = new Set(['script', 'template', 'iframe', 'frame', 'frameset', 'embed', 'applet']);
/** Replaced by its children: the embedded resource is dropped, the fallback content kept. */
const UNWRAPPED_ELEMENT = 'object';
/** Children of `<object>` that only configure the embedded resource. */
const OBJECT_PARAM = 'param';

/**
 * Strips active content from a document in place; returns true when anything was removed.
 * Descendants of an unwrapped `<object>` are visited after it (document order), so its fallback
 * content is sanitized like the rest of the document.
 */
export function stripActiveContent(doc: Document): boolean {
  let removed = false;
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const name = nameOf(el);
    if (REMOVED_ELEMENTS.has(name)) {
      el.parentNode?.removeChild(el);
      removed = true;
      continue;
    }
    if (name === UNWRAPPED_ELEMENT) {
      unwrapObject(el);
      removed = true;
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (!isActiveAttribute(attr.name, attr.value)) continue;
      el.removeAttribute(attr.name);
      removed = true;
    }
  }
  if (doc.documentElement) neutralizeXmlOnlySyntax(doc, doc.documentElement);
  return removed;
}

/** Replaces `<object>` by its children minus `<param>`; a root `<object>` (no element parent) is removed. */
function unwrapObject(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  if (parent.nodeType !== ELEMENT_NODE) {
    parent.removeChild(el);
    return;
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === ELEMENT_NODE && nameOf(child) === OBJECT_PARAM) continue;
    parent.insertBefore(child, el);
  }
  parent.removeChild(el);
}

/**
 * Processing instructions, CDATA sections and comments are inert in XML, but a browser that parses
 * the serialized file as HTML (an `.html` file served over HTTP) reads `<?` and `<![CDATA[` as
 * bogus comments ending at the first `>`, and ends a raw-text element (`<style>`, `<title>`,
 * `<noscript>`, `<textarea>`, `<xmp>`, `<noembed>`) at its end tag even inside `<!-- -->`, so
 * markup hidden inside them would come alive. Processing instructions and comments inside the
 * document element are removed, CDATA sections become equivalent text (serialized escaped). None
 * changes the XML meaning, so none counts as a removal: the prolog of a re-serialized document is
 * never written (except validated CSS stylesheet instructions). A file left as is has an XML
 * extension or media type, so it stays XML-parsed; a file recognized as markup by content only is
 * always rewritten (`sanitizeMarkupFile`).
 */
function neutralizeXmlOnlySyntax(doc: Document, parent: Node): void {
  for (let node = parent.firstChild; node; ) {
    const next = node.nextSibling;
    if (node.nodeType === PROCESSING_INSTRUCTION_NODE || node.nodeType === COMMENT_NODE) parent.removeChild(node);
    else if (node.nodeType === CDATA_SECTION_NODE) parent.replaceChild(doc.createTextNode((node as CDATASection).data), node);
    else if (node.nodeType === ELEMENT_NODE) neutralizeXmlOnlySyntax(doc, node);
    node = next;
  }
}

/** Drops the `scripted` manifest property of an item whose document no longer has scripts or forms. */
export function unmarkScripted(pkg: PackageInfo, path: string, doc: Document): void {
  if (byLocalName(doc, 'form').length > 0) return;
  const item = pkg.manifest.find((m) => m.path === path);
  if (!item?.properties.includes('scripted')) return;
  item.properties = item.properties.filter((p) => p !== 'scripted');
  const el = byLocalName(pkg.opf, 'item').find((i) => i.getAttribute('id') === item.id);
  if (!el) return;
  if (item.properties.length) el.setAttribute('properties', item.properties.join(' '));
  else el.removeAttribute('properties');
}

/** Stand-ins for files that are not well-formed: browsers run scripts that precede the first XML error. */
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const EMPTY_XML = '<removed/>';

/** How `sanitizeMarkupFile` treats one file. */
export interface SanitizeMarkupOptions {
  /** Recognized as markup by content only (always rewritten). */
  byContent?: boolean;
  /** Belongs to an EPUB 2 package: XHTML is written without the HTML5 doctype (`exportDoctype`). */
  epub2?: boolean;
}

/**
 * Sanitizes one markup file and returns its new text, or undefined when it can stay as is.
 * XHTML is always rebuilt (markup that is not well-formed is re-parsed as HTML and written as
 * XHTML); SVG and other XML that is not well-formed is replaced by an empty stand-in. A file with
 * any `xml-stylesheet` instruction is always rewritten, keeping only validated CSS instructions:
 * the rest of the prolog is dropped, and with it XSL stylesheets. A file recognized as markup by
 * content only (`byContent`) is always rewritten too: it may be served without a media type and
 * sniffed as HTML, and only a re-serialized document is sure to carry no comment, processing
 * instruction, CDATA section or doctype an HTML parser would misread.
 */
export function sanitizeMarkupFile(
  env: DomEnv,
  kind: MarkupKind,
  markup: string,
  options: SanitizeMarkupOptions = {},
): { text: string; doc: Document } | undefined {
  const { byContent = false, epub2 = false } = options;
  const stylesheets = cssStylesheetInstructions(markup);
  if (kind === 'xhtml') {
    const doc = parseXhtmlDocument(env, markup);
    stripActiveContent(doc);
    return { text: serializeXhtmlDocument(env, doc, exportDoctype(markup, epub2), stylesheets), doc };
  }
  const mime = kind === 'svg' ? 'image/svg+xml' : 'application/xml';
  const parse = (text: string) => new env.DOMParser().parseFromString(text, mime);
  const standIn = () => {
    const text = `<?xml version="1.0" encoding="utf-8"?>\n${kind === 'svg' ? EMPTY_SVG : EMPTY_XML}\n`;
    return { text, doc: parse(text) };
  };
  const doc = parse(markup);
  if (isParserError(doc)) return standIn();
  const stripped = stripActiveContent(doc);
  if (!doc.documentElement) return standIn(); // the root element itself was active content
  return stripped || byContent || hasStylesheetInstruction(markup) ? { text: serializeXmlDocument(env, doc, stylesheets), doc } : undefined;
}

/**
 * Sanitizes every file of the package that the export does not write itself (`done` and the
 * package documents): manifest XHTML/SVG items such as covers and image pages, other XML items,
 * files under `META-INF/`, and any other file whose content starts with markup (`<`), whatever
 * its declared media type. Content is not checked for resources META-INF/encryption.xml lists
 * (obfuscated fonts are opaque bytes) or whose extension marks them as non-markup
 * (`isNonMarkupPath`: CSS, scripts, images, fonts, media, ...); unknown extensions are checked.
 * Run after `prunePackageFiles`, so no unreferenced file is left. `mimetype` is skipped.
 * `renditions` lists the primary package first; its media types win for files several renditions
 * share.
 */
export function stripActiveContentFromPackage(files: FileMap, renditions: PackageInfo[], done: Set<string>, env: DomEnv): void {
  const packageDocs = new Set(renditions.map((r) => r.opfPath));
  const mediaTypes = new Map<string, string>();
  const epub2Paths = new Map<string, boolean>();
  for (const rendition of renditions) {
    const epub2 = isEpub2Package(rendition);
    for (const item of rendition.manifest) {
      if (mediaTypes.has(item.path)) continue;
      mediaTypes.set(item.path, item.mediaType);
      epub2Paths.set(item.path, epub2);
    }
  }
  const primaryEpub2 = renditions[0] ? isEpub2Package(renditions[0]) : false;
  const encrypted = readEncryptedPaths(files, env);
  for (const [path, data] of Array.from(files)) {
    if (done.has(path) || path === 'mimetype' || packageDocs.has(path)) continue;
    const declared = markupKindOf(path, mediaTypes.get(path));
    if (!declared && (encrypted.has(path) || isNonMarkupPath(path) || !startsWithMarkup(data))) continue;
    const markup = readText(files, path);
    const epub2 = epub2Paths.get(path) ?? primaryEpub2;
    const result = declared
      ? sanitizeMarkupFile(env, declared, markup, { epub2 })
      : sanitizeMarkupFile(env, sniffMarkupKind(markup), markup, { byContent: true, epub2 });
    if (!result) continue;
    for (const pkg of renditions) unmarkScripted(pkg, path, result.doc);
    files.set(path, encodeUtf8(result.text));
  }
}
