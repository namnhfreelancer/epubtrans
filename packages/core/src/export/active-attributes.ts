/**
 * Attribute-level script vectors: event handlers, `srcdoc`, and attributes carrying
 * `javascript:`, `vbscript:` or HTML `data:` URLs.
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

/** Browsers ignore ASCII whitespace and control characters inside a URL scheme. */
const normalize = (value: string) =>
  Array.from(value)
    .filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .toLowerCase();

/** True when an attribute (or pseudo-attribute) with this name and value can run script. */
export function isActiveAttribute(attrName: string, value: string): boolean {
  const name = attrName.toLowerCase();
  if (name.startsWith('xmlns')) return false;
  const local = name.slice(name.indexOf(':') + 1);
  if (local.startsWith('on') || local === 'srcdoc') return true;
  if (URL_ATTRS.has(local)) return SCRIPT_URL_PREFIX.test(normalize(value));
  return EMBEDDED_URL_ATTRS.has(local) && SCRIPT_URL.test(normalize(value));
}
