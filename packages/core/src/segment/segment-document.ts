import { SEGMENT_ATTR, serializeChildren } from '../dom/fragment-markup';
import { byLocalName, elementChildren, nameOf, TEXT_NODE, textOf } from '../dom/xml-dom-helpers';
import type { Segment } from '../types';
import { hasLetters } from '../util/text-encoding';

/** Never translated: code, math, graphics, scripts and document metadata. */
const SKIP = new Set([
  'pre',
  'code',
  'kbd',
  'samp',
  'math',
  'svg',
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'textarea',
  'iframe',
  'object',
  'video',
  'audio',
]);
/** Block-level elements: a segment is the smallest block that holds text. */
const BLOCK = new Set(
  'address article aside blockquote body caption center dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'.split(
    ' ',
  ),
);
/** Pure structure: never a segment by itself even without block children. */
const STRUCTURAL = new Set(['body', 'ul', 'ol', 'dl', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'hgroup']);
/** Classes written by the exporter; skipped so re-imported bilingual books are not doubled. */
const OWN_OUTPUT = /\bet-tr\b/;

const normalizeHtml = (html: string) => html.replace(/\s+/g, ' ').trim();

function mark(el: Element, id: string): Segment {
  el.setAttribute(SEGMENT_ATTR, id);
  return { id, sourceHtml: normalizeHtml(serializeChildren(el)), sourceText: textOf(el), status: 'pending' };
}

const hasDirectText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === TEXT_NODE && /\S/.test((n as Text).data));

const hasBlockDescendant = (el: Element) => Array.from(el.querySelectorAll('*')).some((d) => BLOCK.has(nameOf(d)));

/** Text that remains once code-like descendants are removed. */
function proseText(el: Element): string {
  let text = textOf(el);
  for (const name of ['code', 'kbd', 'samp', 'math', 'svg']) {
    for (const d of byLocalName(el, name)) text = text.replace(textOf(d), '');
  }
  return text;
}

/**
 * Marks translatable blocks of a content document with `data-et-id` and returns their segments.
 * A segment is a block whose content is inline-only (or that mixes text with blocks).
 */
export function segmentContentDocument(doc: Document, idPrefix: string): Segment[] {
  const segments: Segment[] = [];
  const walk = (el: Element) => {
    const name = nameOf(el);
    if (SKIP.has(name) || OWN_OUTPUT.test(el.getAttribute('class') ?? '')) return;
    if (name === 'figure' && (byLocalName(el, 'pre').length || byLocalName(el, 'code').length)) return;
    const leaf = !STRUCTURAL.has(name) && (!hasBlockDescendant(el) || hasDirectText(el));
    if (leaf) {
      if (hasLetters(proseText(el))) segments.push(mark(el, `${idPrefix}${segments.length}`));
      return;
    }
    for (const child of elementChildren(el)) walk(child);
  };
  const body = byLocalName(doc, 'body')[0];
  if (body) walk(body);
  return segments;
}

function hasMarkedAncestor(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute(SEGMENT_ATTR)) return true;
  return false;
}

/** EPUB 3 navigation document: every TOC label (`a`, `span`, headings inside `nav`) is a segment. */
export function segmentNavDocument(doc: Document, idPrefix: string): Segment[] {
  const segments: Segment[] = [];
  const labels = new Set(['a', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  for (const nav of byLocalName(doc, 'nav')) {
    for (const el of Array.from(nav.querySelectorAll('*'))) {
      if (!labels.has(nameOf(el)) || hasMarkedAncestor(el)) continue;
      if (hasLetters(textOf(el))) segments.push(mark(el, `${idPrefix}${segments.length}`));
    }
  }
  return segments;
}

/** EPUB 2 NCX: the book title and every navigation label. */
export function segmentNcx(doc: Document, idPrefix: string): Segment[] {
  const segments: Segment[] = [];
  for (const el of byLocalName(doc, 'text')) {
    const parent = el.parentNode ? nameOf(el.parentNode) : '';
    if ((parent === 'navlabel' || parent === 'doctitle') && hasLetters(textOf(el))) {
      segments.push(mark(el, `${idPrefix}${segments.length}`));
    }
  }
  return segments;
}
