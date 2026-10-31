import { stripXmlInvalidChars } from '../util/xml-chars';
import { ELEMENT_NODE, NS, nameOf, TEXT_NODE } from './xml-dom-helpers';

/**
 * Copies nodes parsed by an HTML parser into an XHTML (XML) document.
 * `strict` mode targets EPUB 3 validity for converted MOBI/FB2 content: legacy
 * presentational elements are mapped to HTML5 equivalents and only known attributes kept.
 */
export interface ConvertOptions {
  strict: boolean;
  /** Ids already used in the target document; duplicates are dropped. */
  usedIds?: Set<string>;
}

const DROP = new Set([
  'script',
  'noscript',
  'iframe',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'guide',
  'reference',
  'head',
  'meta',
  'base',
  'template',
]);
const RENAME: Record<string, string> = {
  font: 'span',
  center: 'div',
  big: 'span',
  tt: 'code',
  strike: 's',
  blink: 'span',
  nobr: 'span',
  listing: 'pre',
  xmp: 'pre',
  plaintext: 'pre',
  basefont: 'span',
  marquee: 'span',
  spacer: 'span',
  acronym: 'abbr',
  dir: 'ul',
  menu: 'ul',
};
const HTML5 = new Set(
  'a abbr address article aside audio b bdi bdo blockquote body br caption cite code col colgroup data dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p picture pre q rp rt ruby s samp section small source span strong sub summary sup table tbody td tfoot th thead time tr track u ul var video wbr svg math'.split(
    ' ',
  ),
);
const GLOBAL_ATTRS = new Set(['id', 'class', 'title', 'lang', 'dir', 'style', 'role']);
const ELEMENT_ATTRS: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan', 'headers'],
  th: ['colspan', 'rowspan', 'headers', 'scope'],
  ol: ['start', 'reversed', 'type'],
  col: ['span'],
  colgroup: ['span'],
  blockquote: ['cite'],
  q: ['cite'],
  del: ['cite', 'datetime'],
  ins: ['cite', 'datetime'],
  time: ['datetime'],
  data: ['value'],
  source: ['src', 'type'],
  audio: ['src', 'controls'],
  video: ['src', 'controls', 'poster', 'width', 'height'],
};
const XML_NAME = /^[A-Za-z_][\w.-]*$/;

/**
 * Converts HTML-parsed nodes into nodes of `target`. Text and attribute values lose the characters XML 1.0 forbids: the
 * HTML parser decodes references such as `&#xFFFE;` or `&#1;` into raw characters, which would make the serialized
 * XHTML not well-formed.
 */
export function convertHtmlNodes(nodes: Iterable<Node>, target: Document, opts: ConvertOptions): Node[] {
  const out: Node[] = [];
  for (const node of nodes) out.push(...convertNode(node, target, opts, NS.XHTML));
  return out;
}

function convertNode(node: Node, target: Document, opts: ConvertOptions, ns: string): Node[] {
  if (node.nodeType === TEXT_NODE) return [target.createTextNode(stripXmlInvalidChars((node as Text).data))];
  if (node.nodeType !== ELEMENT_NODE) return [];
  const src = node as Element;
  const raw = (src.localName ?? src.nodeName).toLowerCase();
  const childrenOf = (childNs: string) => convertChildren(src, target, opts, childNs);
  if (raw.includes(':')) return childrenOf(ns);
  let name = nameOf(src);
  if (DROP.has(name)) return [];
  // The embedded resource is dropped, its fallback content kept.
  if (name === 'object') return childrenOf(ns).filter((n) => nameOf(n) !== 'param');
  let childNs = ns;
  if (name === 'svg') childNs = NS.SVG;
  if (childNs === NS.XHTML && opts.strict) {
    name = RENAME[name] ?? name;
    if (!HTML5.has(name) || name === 'math') return childrenOf(ns);
  }
  const keepSvgCase = childNs === NS.SVG ? (src.localName ?? name) : name;
  const el = target.createElementNS(childNs, keepSvgCase);
  copyAttributes(src, el, name, childNs, opts);
  if (opts.strict && name === 'img' && !el.hasAttribute('alt')) el.setAttribute('alt', '');
  const children = childrenOf(childNs);
  // Attribute-less spans (often former <font>) and empty anchors only add noise to segments.
  if (opts.strict && el.attributes.length === 0 && (name === 'span' || (name === 'a' && children.length === 0))) return children;
  for (const child of children) el.appendChild(child);
  return [el];
}

function convertChildren(src: Element, target: Document, opts: ConvertOptions, ns: string): Node[] {
  const out: Node[] = [];
  for (let c = src.firstChild; c; c = c.nextSibling) out.push(...convertNode(c, target, opts, ns));
  return out;
}

function copyAttributes(src: Element, el: Element, name: string, ns: string, opts: ConvertOptions): void {
  for (const attr of Array.from(src.attributes)) {
    const attrName = attr.name.toLowerCase();
    const value = stripXmlInvalidChars(attr.value);
    if (attrName.startsWith('xmlns')) continue;
    if (attrName === 'xml:lang') {
      el.setAttributeNS(NS.XML, 'xml:lang', value);
      continue;
    }
    if (attrName === 'epub:type') {
      el.setAttributeNS(NS.EPUB, 'epub:type', value);
      continue;
    }
    if (attrName === 'xlink:href' && ns === NS.SVG) {
      el.setAttributeNS(NS.XLINK, 'xlink:href', value);
      continue;
    }
    if (!XML_NAME.test(attr.name)) continue;
    if (attrName === 'id' && !acceptId(value, opts)) continue;
    if (opts.strict && ns === NS.XHTML && !isAllowedAttribute(name, attrName, value)) continue;
    el.setAttribute(ns === NS.SVG ? attr.name : attrName, value);
  }
}

function acceptId(value: string, opts: ConvertOptions): boolean {
  if (!value || /\s/.test(value)) return false;
  if (!opts.usedIds) return true;
  if (opts.usedIds.has(value)) return false;
  opts.usedIds.add(value);
  return true;
}

function isAllowedAttribute(element: string, attr: string, value: string): boolean {
  if (GLOBAL_ATTRS.has(attr) || attr.startsWith('data-') || attr.startsWith('aria-')) return true;
  if (!ELEMENT_ATTRS[element]?.includes(attr)) return false;
  if ((attr === 'width' || attr === 'height') && !/^\d+$/.test(value)) return false;
  if ((attr === 'colspan' || attr === 'rowspan' || attr === 'start' || attr === 'span') && !/^\d+$/.test(value)) return false;
  return true;
}
