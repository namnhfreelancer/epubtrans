import { ELEMENT_NODE, getAttrLocal, nameOf, TEXT_NODE } from '../dom/xml-dom-helpers';

/**
 * Text that Word Wise hints may annotate, read the same way from a segment's `sourceHtml` (selection, no DOM needed)
 * and from the exported DOM (placement): text nodes in document order, outside code, math, ruby, sub/sup, note
 * references, link text, form controls and their labels, and fallback content. Both sides tokenize each text node
 * separately with the same segmenter, count occurrences of a word per segment and apply the same "glued" rule, so an
 * occurrence stored as (word, nth) finds the same text node at export.
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
  'button',
  'select',
  'option',
  'label',
  'noscript',
  'object',
  'video',
  'audio',
  'canvas',
  'iframe',
  'template',
]);
/** Block elements: text on either side of their tags belongs to different lines, never to one word. */
const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'nav',
  'ol',
  'p',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NOTEREF = /\bnoteref\b/;
const DOC_NOTEREF = /\bdoc-noteref\b/;

/** Skipped subtrees: the elements above, note references, and link text (`a` with an `href`; plain anchors stay). */
const isSkipped = (name: string, type: string | null, role: string | null, href: string | null) =>
  SKIP_ELEMENTS.has(name) || (name === 'a' && (href !== null || NOTEREF.test(type ?? '') || DOC_NOTEREF.test(role ?? '')));

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * Letters that continue a word across a tag: `<span>A</span>lthough`, `<b>W</b>hen`, `<i>un</i>usual`. Scripts
 * written without spaces (Han, kana, Thai…) are excluded: there a tag boundary says nothing about word boundaries.
 */
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const joins = (ch: string | undefined) => ch !== undefined && WORD_CHAR.test(ch) && !UNSPACED.test(ch);
const firstChar = (text: string) => (text ? String.fromCodePoint(text.codePointAt(0) as number) : undefined);
const lastChar = (text: string) => {
  const cp = text.length > 1 && /[\uDC00-\uDFFF]/.test(text[text.length - 1] as string) ? text.slice(-2) : text.slice(-1);
  return cp || undefined;
};

/** Whether a text piece continues a word of the neighbouring text (no space or block boundary in between). */
export interface Glue {
  before: boolean;
  after: boolean;
}

/** Glue of every text piece in a sequence where `null` marks a boundary (block tag, `<br>`, skipped element). */
function glueOf(pieces: readonly (string | null)[]): (Glue | undefined)[] {
  const out: (Glue | undefined)[] = pieces.map((p) => (p === null ? undefined : { before: false, after: false }));
  let prev: { index: number; char: string | undefined } | undefined;
  pieces.forEach((piece, i) => {
    if (piece === null) {
      prev = undefined;
      return;
    }
    if (!piece) return;
    if (prev && joins(prev.char) && joins(firstChar(piece))) {
      (out[i] as Glue).before = true;
      (out[prev.index] as Glue).after = true;
    }
    prev = { index: i, char: lastChar(piece) };
  });
  return out;
}

/** A token touching a tag that splits a word (drop caps, split emphasis) is no word of its own and gets no hint. */
export function isGluedToken(text: string, glue: Glue, token: WordToken): boolean {
  return (glue.before && token.index === 0) || (glue.after && token.index + token.word.length === text.length);
}

/** Eligible text of a segment, with the glue of each chunk. Boundaries are chunks of one space, glued to nothing. */
export interface HintTextChunk {
  text: string;
  glue: Glue;
}

const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<[^>]*>|([^<]+)/g;
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? '') : null;
};

/**
 * Eligible text of a segment's serialized markup, in document order. A `<br>`, a block tag or a skipped element
 * yields a single space, so words on both sides stay apart in the joined context text (spaces carry no words, so
 * counts are unaffected); leading, trailing and repeated boundaries are dropped.
 */
export function hintTextChunks(html: string): HintTextChunk[] {
  const pieces: (string | null)[] = [];
  const stack: { name: string; skip: boolean }[] = [];
  const skipping = () => stack.length > 0 && (stack[stack.length - 1] as { skip: boolean }).skip;
  for (const m of html.matchAll(TAG)) {
    if (m[5] !== undefined) {
      if (!skipping()) pieces.push(decodeEntities(m[5]));
      continue;
    }
    const name = m[2]?.toLowerCase();
    if (!name) continue;
    const local = name.slice(name.indexOf(':') + 1);
    if (m[1]) {
      const at = stack.map((s) => s.name).lastIndexOf(local);
      if (at >= 0) {
        if ((stack[at]?.skip && !(stack[at - 1]?.skip ?? false)) || (BLOCK_ELEMENTS.has(local) && !skipping())) pieces.push(null);
        stack.length = at;
      }
      continue;
    }
    const attrs = m[3] ?? '';
    const skipped = isSkipped(local, attr(attrs, 'type'), attr(attrs, 'role'), attr(attrs, 'href'));
    if (VOID.has(local) || m[4]) {
      if ((local === 'br' || BLOCK_ELEMENTS.has(local) || skipped) && !skipping()) pieces.push(null);
      continue;
    }
    if (BLOCK_ELEMENTS.has(local) && !skipping()) pieces.push(null);
    stack.push({ name: local, skip: skipping() || skipped });
  }
  return toChunks(pieces);
}

function toChunks(pieces: readonly (string | null)[]): HintTextChunk[] {
  const glue = glueOf(pieces);
  const chunks: HintTextChunk[] = [];
  let boundary = false;
  pieces.forEach((piece, i) => {
    if (piece === null) {
      boundary = chunks.length > 0;
      return;
    }
    if (boundary) chunks.push({ text: ' ', glue: { before: false, after: false } });
    boundary = false;
    chunks.push({ text: piece, glue: glue[i] as Glue });
  });
  return chunks;
}

/**
 * Calls `visit` for every eligible text node below `root`, in document order, with its glue (a snapshot: callers may
 * replace nodes). Boundaries match {@link hintTextChunks}: `<br>`, block tags and skipped elements.
 */
export function forEachHintTextNode(root: Element, visit: (node: Text, glue: Glue) => void): void {
  const nodes: (Text | null)[] = [];
  const walk = (node: Node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === TEXT_NODE) nodes.push(c as Text);
      else if (c.nodeType === ELEMENT_NODE) {
        const el = c as Element;
        const name = nameOf(el);
        if (isSkipped(name, getAttrLocal(el, 'type'), el.getAttribute('role'), getAttrLocal(el, 'href'))) nodes.push(null);
        else if (name === 'br') nodes.push(null);
        else if (BLOCK_ELEMENTS.has(name)) {
          nodes.push(null);
          walk(el);
          nodes.push(null);
        } else walk(el);
      }
    }
  };
  walk(root);
  const glue = glueOf(nodes.map((n) => (n === null ? null : n.data)));
  nodes.forEach((n, i) => {
    if (n) visit(n, glue[i] as Glue);
  });
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
