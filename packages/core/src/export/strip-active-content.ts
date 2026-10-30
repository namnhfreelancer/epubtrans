import { extractDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, isParserError, nameOf } from '../dom/xml-dom-helpers';
import { type PackageInfo, readText } from '../epub/package-document';
import type { DomEnv } from '../types';
import { encodeUtf8 } from '../util/text-encoding';
import type { FileMap } from '../util/zip-archive';

/**
 * Defense in depth for exported books: neither model output nor the source book may leave a
 * script vector in a content document. Removes `<script>` elements, event-handler (`on*`) and
 * `srcdoc` attributes, and attributes carrying `javascript:`, `vbscript:` or HTML `data:` URLs.
 */

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
/** Cheap pre-check for documents that are otherwise copied untouched (references may hide a scheme). */
const MAYBE_ACTIVE = /<script|\son[a-z]|srcdoc|script:|data:|&(?!(?:amp|lt|gt|quot|apos);)/i;

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
    if (nameOf(el) === 'script') {
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

/**
 * Sanitizes every XHTML/SVG document of the package that the export did not rewrite itself
 * (`done`), e.g. covers and image pages without text. Unreadable SVG is left alone: reading
 * systems cannot render (or run) markup that is not well-formed XML.
 */
export function stripActiveContentFromPackage(files: FileMap, pkg: PackageInfo, done: Set<string>, env: DomEnv): void {
  for (const item of pkg.manifest) {
    const xhtml = item.mediaType === 'application/xhtml+xml';
    if (done.has(item.path) || !files.has(item.path) || (!xhtml && item.mediaType !== 'image/svg+xml')) continue;
    const markup = readText(files, item.path);
    if (!MAYBE_ACTIVE.test(markup)) continue;
    if (xhtml) {
      const doc = parseXhtmlDocument(env, markup);
      stripActiveContent(doc);
      unmarkScripted(pkg, item.path, doc);
      files.set(item.path, encodeUtf8(serializeXhtmlDocument(env, doc, extractDoctype(markup))));
      continue;
    }
    const doc = new env.DOMParser().parseFromString(markup, 'image/svg+xml');
    if (isParserError(doc)) continue;
    if (stripActiveContent(doc)) {
      unmarkScripted(pkg, item.path, doc);
      files.set(item.path, encodeUtf8(serializeXmlDocument(env, doc)));
    }
  }
}
