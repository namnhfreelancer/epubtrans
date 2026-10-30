import type { DomEnv } from '../types';
import { escapeXml } from '../util/text-encoding';
import { convertHtmlNodes } from './html-to-xhtml';
import { CDATA_SECTION_NODE, ELEMENT_NODE, firstByLocalName, nameOf, TEXT_NODE } from './xml-dom-helpers';

/** Attribute used to mark segment blocks inside the normalized source package. */
export const SEGMENT_ATTR = 'data-et-id';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Deterministic serializer for segment markup. Output is both well-formed XML and
 * parseable HTML, independent of the DOM implementation (unlike XMLSerializer, which
 * adds xmlns declarations in browsers and self-closes non-void elements in linkedom).
 */
export function serializeChildren(el: Node): string {
  let out = '';
  for (let c = el.firstChild; c; c = c.nextSibling) out += serializeNode(c);
  return out;
}

function serializeNode(node: Node): string {
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
    return escapeXml((node as Text).data).replace(/&quot;/g, '"');
  }
  if (node.nodeType !== ELEMENT_NODE) return '';
  const el = node as Element;
  const name = nameOf(el);
  let attrs = '';
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === SEGMENT_ATTR || attr.name.startsWith('xmlns')) continue;
    attrs += ` ${attr.name}="${escapeXml(attr.value)}"`;
  }
  if (VOID.has(name)) return `<${name}${attrs}/>`;
  return `<${name}${attrs}>${serializeChildren(el)}</${name}>`;
}

/** Parses an HTML fragment with the lenient HTML parser and returns its container element. */
export function parseHtmlFragment(env: DomEnv, html: string): Element {
  const doc = new env.DOMParser().parseFromString(`<!DOCTYPE html><html><body><div>${html}</div></body></html>`, 'text/html');
  const body = firstByLocalName(doc, 'body');
  const container = body ? firstByLocalName(body, 'div') : undefined;
  if (!container) throw new Error('Unable to parse HTML fragment');
  return container;
}

/** Converts an HTML fragment into XHTML nodes owned by `target`. */
export function fragmentToNodes(env: DomEnv, html: string, target: Document): Node[] {
  return convertHtmlNodes(Array.from(parseHtmlFragment(env, html).childNodes), target, { strict: false });
}
