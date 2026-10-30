import { extractDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, isParserError, nameOf } from '../dom/xml-dom-helpers';
import { type PackageInfo, readText } from '../epub/package-document';
import type { DomEnv } from '../types';
import { encodeUtf8 } from '../util/text-encoding';
import type { FileMap } from '../util/zip-archive';

/**
 * Defense in depth for exported books: neither model output nor the source book may leave a
 * script vector in any markup file of the package. Removes `<script>` and embedding elements
 * (`iframe`, `object`, ...) whatever their namespace prefix, event-handler (`on*`) and `srcdoc`
 * attributes, and attributes carrying `javascript:`, `vbscript:` or HTML `data:` URLs.
 */

/** Elements removed with their content: scripts, and elements that embed another (unsanitized) document. */
const REMOVED_ELEMENTS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet']);

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

/** Strips active content from a document in place; returns true when anything was removed. */
export function stripActiveContent(doc: Document): boolean {
  let removed = false;
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (REMOVED_ELEMENTS.has(nameOf(el))) {
      el.parentNode?.removeChild(el);
      removed = true;
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (!isActiveAttribute(attr.name, attr.value)) continue;
      el.removeAttribute(attr.name);
      removed = true;
    }
  }
  return removed;
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

/**
 * How a reading system may interpret a package file: by manifest media type, else by extension
 * (files missing from the manifest can still be linked or embedded).
 */
export function markupKindOf(path: string, mediaType = ''): MarkupKind | undefined {
  if (mediaType === 'application/xhtml+xml' || mediaType === 'text/html') return 'xhtml';
  if (mediaType === 'image/svg+xml') return 'svg';
  if (/[/+]xml$/.test(mediaType)) return 'xml';
  if (/\.(?:x?html?|xht)$/i.test(path)) return 'xhtml';
  if (/\.svg$/i.test(path)) return 'svg';
  if (/\.xml$/i.test(path)) return 'xml';
  return undefined;
}

/**
 * Sanitizes one markup file and returns its new text, or undefined when it can stay as is.
 * XHTML is always rebuilt (markup that is not well-formed is re-parsed as HTML and written as
 * XHTML); SVG and other XML that is not well-formed is replaced by an empty stand-in.
 */
export function sanitizeMarkupFile(env: DomEnv, kind: MarkupKind, markup: string): { text: string; doc: Document } | undefined {
  if (kind === 'xhtml') {
    const doc = parseXhtmlDocument(env, markup);
    stripActiveContent(doc);
    return { text: serializeXhtmlDocument(env, doc, extractDoctype(markup)), doc };
  }
  const mime = kind === 'svg' ? 'image/svg+xml' : 'application/xml';
  const parse = (text: string) => new env.DOMParser().parseFromString(text, mime);
  const doc = parse(markup);
  if (isParserError(doc)) {
    const text = `<?xml version="1.0" encoding="utf-8"?>\n${kind === 'svg' ? EMPTY_SVG : EMPTY_XML}\n`;
    return { text, doc: parse(text) };
  }
  return stripActiveContent(doc) ? { text: serializeXmlDocument(env, doc), doc } : undefined;
}

/**
 * Sanitizes every markup file of the package that the export did not rewrite itself (`done`):
 * manifest XHTML/SVG items such as covers and image pages, other XML items, and HTML/SVG/XML
 * files the manifest does not reference. `mimetype` and the OPF (rewritten from `pkg`) are skipped.
 */
export function stripActiveContentFromPackage(files: FileMap, pkg: PackageInfo, done: Set<string>, env: DomEnv): void {
  const mediaTypes = new Map(pkg.manifest.map((m) => [m.path, m.mediaType]));
  for (const path of Array.from(files.keys())) {
    if (done.has(path) || path === 'mimetype' || path === pkg.opfPath) continue;
    const kind = markupKindOf(path, mediaTypes.get(path));
    if (!kind) continue;
    const result = sanitizeMarkupFile(env, kind, readText(files, path));
    if (!result) continue;
    unmarkScripted(pkg, path, result.doc);
    files.set(path, encodeUtf8(result.text));
  }
}
