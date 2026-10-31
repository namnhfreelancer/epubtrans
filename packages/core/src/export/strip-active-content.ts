import { exportDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, CDATA_SECTION_NODE, ELEMENT_NODE, isParserError, nameOf, PROCESSING_INSTRUCTION_NODE } from '../dom/xml-dom-helpers';
import { isEpub2Package, type PackageInfo, readText } from '../epub/package-document';
import type { DomEnv } from '../types';
import { normalizeMediaType } from '../util/media-type';
import { encodeUtf8 } from '../util/text-encoding';
import type { FileMap } from '../util/zip-archive';

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

/** Attributes whose whole value is a URL (compared by un-prefixed local name, so `xlink:href` counts as `href`). */
const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
  'codebase',
  'cite',
  'longdesc',
  'usemap',
  'manifest',
  'classid',
  'archive',
  'lowsrc',
  'dynsrc',
  'icon',
  'profile',
]);
/** Attributes that can embed a URL anywhere in their value (CSS, meta refresh, URL lists, SVG animation). */
const EMBEDDED_URL_ATTRS = new Set(['style', 'content', 'srcset', 'ping', 'values', 'to', 'from', 'by']);
const SCRIPT_URL = /(?:javascript|vbscript):|data:(?:text\/html|application\/xhtml\+xml)/;
const SCRIPT_URL_PREFIX = new RegExp(`^(?:${SCRIPT_URL.source})`);

/** Browsers ignore ASCII whitespace and control characters inside a URL scheme. */
const normalize = (value: string) =>
  Array.from(value)
    .filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .toLowerCase();

function isActiveAttribute(attrName: string, value: string): boolean {
  const name = attrName.toLowerCase();
  if (name.startsWith('xmlns')) return false;
  const local = name.slice(name.indexOf(':') + 1);
  if (local.startsWith('on') || local === 'srcdoc') return true;
  if (URL_ATTRS.has(local)) return SCRIPT_URL_PREFIX.test(normalize(value));
  return EMBEDDED_URL_ATTRS.has(local) && SCRIPT_URL.test(normalize(value));
}

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
 * Processing instructions and CDATA sections are inert in XML, but a browser that parses the
 * serialized file as HTML (an `.html` file served over HTTP) reads `<?` and `<![CDATA[` as bogus
 * comments ending at the first `>`, so markup hidden inside them would come alive. Processing
 * instructions inside the document element are removed, CDATA sections become equivalent text
 * (serialized escaped). Neither changes the XML meaning, so neither counts as a removal: the
 * prolog of a re-serialized document is never written, and a file left as is stays XML-parsed.
 */
function neutralizeXmlOnlySyntax(doc: Document, parent: Node): void {
  for (let node = parent.firstChild; node; ) {
    const next = node.nextSibling;
    if (node.nodeType === PROCESSING_INSTRUCTION_NODE) parent.removeChild(node);
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

type MarkupKind = 'xhtml' | 'svg' | 'xml';

/** Stand-ins for files that are not well-formed: browsers run scripts that precede the first XML error. */
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const EMPTY_XML = '<removed/>';

/** Extensions a browser parses as HTML when the file is served over HTTP. */
const HTML_PARSED_PATH = /\.s?html?$/i;

/**
 * How a reading system or browser may interpret a package file. Files a browser parses as HTML
 * by extension are always XHTML (so they are rebuilt), whatever their declared media type;
 * otherwise the manifest media type (parameters ignored) decides, else the extension.
 */
export function markupKindOf(path: string, mediaType = ''): MarkupKind | undefined {
  const type = normalizeMediaType(mediaType);
  if (HTML_PARSED_PATH.test(path) || type === 'application/xhtml+xml' || type === 'text/html') return 'xhtml';
  if (type === 'image/svg+xml') return 'svg';
  if (/[/+]xml$/.test(type)) return 'xml';
  if (/\.xht(?:ml)?$/i.test(path)) return 'xhtml';
  if (/\.svg$/i.test(path)) return 'svg';
  if (/\.xml$/i.test(path)) return 'xml';
  return undefined;
}

const XML_STYLESHEET_PI = /<\?xml-stylesheet\b([\s\S]*?)\?>/gi;
const PSEUDO_ATTR_TYPE = /(?:^|\s)type\s*=\s*(["'])(.*?)\1/i;

/**
 * True when the markup has an `xml-stylesheet` processing instruction that is not plain CSS:
 * browsers apply XSLT (`text/xsl`, `application/xslt+xml`, `text/xml`, ...) stylesheets, whose
 * output may contain scripts. Detected in the text because some DOMs (linkedom) drop the prolog's
 * processing instructions while parsing.
 */
export function hasXslStylesheet(markup: string): boolean {
  for (const [, data = ''] of markup.matchAll(XML_STYLESHEET_PI)) {
    const type = normalizeMediaType(PSEUDO_ATTR_TYPE.exec(data)?.[2] ?? '');
    if (type !== '' && type !== 'text/css') return true;
  }
  return false;
}

/**
 * Sanitizes one markup file and returns its new text, or undefined when it can stay as is.
 * XHTML is always rebuilt (markup that is not well-formed is re-parsed as HTML and written as
 * XHTML); SVG and other XML that is not well-formed is replaced by an empty stand-in. Rewritten
 * files lose their prolog, which drops XSL `xml-stylesheet` instructions; a file that has one is
 * always rewritten.
 */
export function sanitizeMarkupFile(env: DomEnv, kind: MarkupKind, markup: string, epub2 = false): { text: string; doc: Document } | undefined {
  if (kind === 'xhtml') {
    const doc = parseXhtmlDocument(env, markup);
    stripActiveContent(doc);
    return { text: serializeXhtmlDocument(env, doc, exportDoctype(markup, epub2)), doc };
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
  return stripped || hasXslStylesheet(markup) ? { text: serializeXmlDocument(env, doc), doc } : undefined;
}

/**
 * Sanitizes every markup file of the package that the export did not rewrite itself (`done`):
 * manifest XHTML/SVG items such as covers and image pages, other XML items, and markup files under
 * `META-INF/`. Run after `prunePackageFiles`, so no unreferenced file is left. `mimetype` and the
 * OPF (rewritten from `pkg`) are skipped.
 */
export function stripActiveContentFromPackage(files: FileMap, pkg: PackageInfo, done: Set<string>, env: DomEnv): void {
  const mediaTypes = new Map(pkg.manifest.map((m) => [m.path, m.mediaType]));
  for (const path of Array.from(files.keys())) {
    if (done.has(path) || path === 'mimetype' || path === pkg.opfPath) continue;
    const kind = markupKindOf(path, mediaTypes.get(path));
    if (!kind) continue;
    const result = sanitizeMarkupFile(env, kind, readText(files, path), isEpub2Package(pkg));
    if (!result) continue;
    unmarkScripted(pkg, path, result.doc);
    files.set(path, encodeUtf8(result.text));
  }
}
