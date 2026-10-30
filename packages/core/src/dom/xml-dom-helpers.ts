/**
 * Namespace-tolerant DOM helpers. Browser DOMs are namespace-aware, linkedom is not
 * (it keeps prefixes in local names), so lookups go by un-prefixed local name.
 */
export const NS = {
  XHTML: 'http://www.w3.org/1999/xhtml',
  SVG: 'http://www.w3.org/2000/svg',
  XLINK: 'http://www.w3.org/1999/xlink',
  XML: 'http://www.w3.org/XML/1998/namespace',
  EPUB: 'http://www.idpf.org/2007/ops',
  OPF: 'http://www.idpf.org/2007/opf',
  DC: 'http://purl.org/dc/elements/1.1/',
  NCX: 'http://www.daisy.org/z3986/2005/ncx/',
  CONTAINER: 'urn:oasis:names:tc:opendocument:xmlns:container',
} as const;

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const CDATA_SECTION_NODE = 4;
export const PROCESSING_INSTRUCTION_NODE = 7;

/** Lower-cased local name without namespace prefix. */
export function nameOf(node: Node): string {
  const el = node as Element;
  const raw = el.localName ?? el.nodeName ?? '';
  const i = raw.indexOf(':');
  return (i < 0 ? raw : raw.slice(i + 1)).toLowerCase();
}

export function elementChildren(node: Node): Element[] {
  const out: Element[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === ELEMENT_NODE) out.push(c as Element);
  return out;
}

/** All descendant elements (document order) whose un-prefixed local name equals `name` (case-insensitive). */
export function byLocalName(root: Document | Element, name: string): Element[] {
  const wanted = name.toLowerCase();
  return Array.from(root.querySelectorAll('*')).filter((el) => nameOf(el) === wanted);
}

export function firstByLocalName(root: Document | Element, name: string): Element | undefined {
  return byLocalName(root, name)[0];
}

/** Attribute value matched by un-prefixed local name (e.g. `href` matches `l:href`, `xlink:href`). */
export function getAttrLocal(el: Element, localName: string): string | null {
  const direct = el.getAttribute(localName);
  if (direct !== null) return direct;
  for (const attr of Array.from(el.attributes)) {
    const n = attr.name;
    if (n.slice(n.indexOf(':') + 1) === localName) return attr.value;
  }
  return null;
}

/** Visible text with collapsed whitespace; `<br>` counts as a space. */
export function textOf(node: Node | undefined | null): string {
  return node ? rawText(node).replace(/\s+/g, ' ').trim() : '';
}

function rawText(node: Node): string {
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) return (node as Text).data;
  if (node.nodeType === ELEMENT_NODE && nameOf(node) === 'br') return ' ';
  let out = '';
  for (let c = node.firstChild; c; c = c.nextSibling) out += rawText(c);
  return out;
}

export function isParserError(doc: Document): boolean {
  return !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0;
}

export function parseXml(env: { DOMParser: typeof DOMParser }, markup: string, what: string): Document {
  const doc = new env.DOMParser().parseFromString(markup, 'application/xml');
  if (isParserError(doc)) throw new Error(`Malformed XML in ${what}`);
  return doc;
}
