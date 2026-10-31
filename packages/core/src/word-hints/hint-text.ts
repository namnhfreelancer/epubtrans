import { ELEMENT_NODE, getAttrLocal, nameOf, TEXT_NODE } from '../dom/xml-dom-helpers';

/**
 * Text that Word Wise hints may annotate, read the same way from a segment's `sourceHtml` (selection, no DOM needed)
 * and from the exported DOM (placement): text nodes in document order, outside code, math, ruby, sub/sup and note
 * references. Both sides tokenize each text node separately with the same segmenter and count occurrences of a
 * word per segment, so an occurrence stored as (word, nth) finds the same text node at export.
 */
const SKIP_ELEMENTS = new Set([
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'tt',
  'script',
  'style',
  'math',
  'svg',
  'ruby',
  'rt',
  'rp',
  'textarea',
  'title',
  'sub',
  'sup',
]);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NOTEREF = /\bnoteref\b/;
const DOC_NOTEREF = /\bdoc-noteref\b/;

const isSkipped = (name: string, type: string | null, role: string | null) =>
  SKIP_ELEMENTS.has(name) || (name === 'a' && (NOTEREF.test(type ?? '') || DOC_NOTEREF.test(role ?? '')));

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<[^>]*>|([^<]+)/g;
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? '') : null;
};

/**
 * Eligible text of a segment's serialized markup, in document order. A `<br>` or a skipped element yields a single
 * space, so words on both sides stay apart in the joined context text (spaces carry no words, so counts are unaffected).
 */
export function hintTextChunks(html: string): string[] {
  const chunks: string[] = [];
  const stack: { name: string; skip: boolean }[] = [];
  const skipping = () => stack.length > 0 && (stack[stack.length - 1] as { skip: boolean }).skip;
  for (const m of html.matchAll(TAG)) {
    if (m[5] !== undefined) {
      if (!skipping()) chunks.push(decodeEntities(m[5]));
      continue;
    }
    const name = m[2]?.toLowerCase();
    if (!name) continue;
    const local = name.slice(name.indexOf(':') + 1);
    if (m[1]) {
      const at = stack.map((s) => s.name).lastIndexOf(local);
      if (at >= 0) {
        if (stack[at]?.skip && !(stack[at - 1]?.skip ?? false)) chunks.push(' ');
        stack.length = at;
      }
      continue;
    }
    if (VOID.has(local) || m[4]) {
      if (local === 'br' && !skipping()) chunks.push(' ');
      continue;
    }
    const attrs = m[3] ?? '';
    stack.push({ name: local, skip: skipping() || isSkipped(local, attr(attrs, 'type'), attr(attrs, 'role')) });
  }
  return chunks;
}

/** Calls `visit` for every eligible text node below `root`, in document order (a snapshot: callers may replace nodes). */
export function forEachHintTextNode(root: Element, visit: (node: Text) => void): void {
  const nodes: Text[] = [];
  const walk = (node: Node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === TEXT_NODE) nodes.push(c as Text);
      else if (c.nodeType === ELEMENT_NODE) {
        const el = c as Element;
        if (!isSkipped(nameOf(el), getAttrLocal(el, 'type'), el.getAttribute('role'))) walk(el);
      }
    }
  };
  walk(root);
  for (const n of nodes) visit(n);
}

export interface WordToken {
  word: string;
  index: number;
}

const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang);
  if (!s) {
    s = new Intl.Segmenter(lang, { granularity: 'word' });
    segmenters.set(lang, s);
  }
  return s;
}

/** Word-like tokens of a text (Unicode word segmentation; dictionary-based for Chinese and Japanese). */
export function wordTokens(text: string, lang: string): WordToken[] {
  const out: WordToken[] = [];
  for (const s of segmenterFor(lang).segment(text)) if (s.isWordLike) out.push({ word: s.segment, index: s.index });
  return out;
}

/** Counts occurrences of each exact word within one segment, giving the 0-based `nth` of the next occurrence. */
export class OccurrenceIndex {
  private readonly counts = new Map<string, number>();
  next(word: string): number {
    const n = this.counts.get(word) ?? 0;
    this.counts.set(word, n + 1);
    return n;
  }
}
