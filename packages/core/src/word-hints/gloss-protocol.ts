import { extractJson } from '../translate/prompt-protocol';
import { languageName } from '../translate/token-estimate';
import type { WordHintSense } from '../types';
import { stripXmlInvalidChars } from '../util/xml-chars';

/**
 * Gloss protocol. The system prompt depends only on the language pair, so it is byte-identical for every request of
 * a run (prompt caching). User message: {"items":[{"id","word","lemma","context","senses"?}]}; answer:
 * {"items":[{"id","sense","gloss"} | {"id","skip":true}]}. Glosses are untrusted plain text: tags are stripped,
 * whitespace collapsed and the length capped; export inserts them as text nodes only.
 */
export const MAX_GLOSS_WORDS = 5;
export const MAX_GLOSS_CHARS = 40;
const MAX_SENSE_CHARS = 40;

export interface GlossRequestItem {
  id: string;
  word: string;
  lemma: string;
  context: string;
  /** Senses already glossed for this lemma; the model reuses a label when one fits. */
  senses?: WordHintSense[];
}

export type GlossAnswer = { skip: true } | { skip: false; sense: string; gloss: string };

export function buildGlossSystemPrompt(sourceLang: string, glossLang: string): string {
  const same = sourceLang.split('-')[0]?.toLowerCase() === glossLang.split('-')[0]?.toLowerCase();
  return `You write Word Wise hints: very short glosses shown above difficult words of a book, so a reader of the original text understands them without a dictionary.

Source language (the book): ${languageName(sourceLang)}
Gloss language: ${languageName(glossLang)}

## Rules
- Input is JSON {"items":[{"id":"…","word":"…","lemma":"…","context":"…","senses":[{"id":"…","gloss":"…"}]}]}. "context" is the sentence with the word marked as ⟦word⟧. "lemma" is an automatic guess of the dictionary form; trust the word in context more.
- For every item decide what the marked word means in its context and write "gloss": its meaning in the gloss language, at most 4 words and ${MAX_GLOSS_CHARS} characters, plain text, no quotes, no explanation, no repetition of the word itself.${same ? ' The gloss language is the language of the book: give a simpler common synonym or a tiny definition.' : ''}
- Give "sense": a short English label (1–3 words) naming this meaning of the lemma, e.g. "river edge" or "money institution" for "bank". When one of the item's "senses" fits, copy its "id" exactly as "sense" and reuse its gloss; otherwise invent a new label.
- Answer {"id":"…","skip":true} instead when the word is a proper name, a foreign or broken word, or too common to need a hint.
- Answer with JSON only, no markdown fences, no commentary: {"items":[{"id":"…","sense":"…","gloss":"…"}]} containing every input id exactly once.`;
}

export function buildGlossUserMessage(items: readonly GlossRequestItem[]): string {
  return JSON.stringify({
    items: items.map((i) => ({ id: i.id, word: i.word, lemma: i.lemma, context: i.context, ...(i.senses?.length ? { senses: i.senses } : {}) })),
  });
}

/** Opening → closing character of the quote and bracket pairs a model may wrap a whole gloss in. */
const WRAPPERS: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '「': '」', '『': '』', '(': ')', '[': ']' };
/** Format characters to drop (bidi overrides, zero-width space…), except ZWNJ/ZWJ, which Persian and Indic words need. */
const FORMAT_CHARS = /(?![\u200C\u200D])[\p{Cc}\p{Cf}]/gu;

const count = (text: string, ch: string) => text.split(ch).length - 1;

/** The first and last characters are a quote or bracket pair enclosing the whole text ("(a) or (b)" is not enclosed). */
function enclosed(text: string): boolean {
  const open = text[0] ?? '';
  const close = WRAPPERS[open];
  if (!close || text.length < 2 || text[text.length - 1] !== close) return false;
  if (open === close) return !text.slice(1, -1).includes(open);
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) depth--;
    if (depth === 0) return false;
  }
  return true;
}

/** `ch` (an edge character of `text`) is a quote or bracket without a partner. */
function unpaired(text: string, ch: string): boolean {
  const close = WRAPPERS[ch];
  const open = close === undefined ? Object.keys(WRAPPERS).find((o) => WRAPPERS[o] === ch) : ch;
  if (open === undefined) return false;
  const closer = WRAPPERS[open] as string;
  if (open === closer) return count(text, open) % 2 === 1;
  return ch === open ? count(text, open) > count(text, closer) : count(text, closer) > count(text, open);
}

/** Drops trailing sentence punctuation, quotes or brackets around the whole gloss and unpaired ones at either end. */
function unwrap(text: string): string {
  let out = text;
  for (let before = ''; out !== before; ) {
    before = out;
    out = out.replace(/[.;,。、]+$/u, '').trim();
    if (enclosed(out)) out = out.slice(1, -1).trim();
    else if (out && unpaired(out, out[0] as string) && WRAPPERS[out[0] as string]) out = out.slice(1).trim();
    else if (out && unpaired(out, out[out.length - 1] as string)) out = out.slice(0, -1).trim();
  }
  return out;
}

/**
 * Plain-text gloss within the caps, or undefined when the model's text is unusable. Tags, controls, format characters
 * (but not ZWNJ/ZWJ) and XML-invalid characters are removed; quotes or brackets wrapping the whole gloss are dropped,
 * while balanced ones inside it ("bank (river)") are kept.
 */
export function cleanGloss(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = unwrap(
    stripXmlInvalidChars(raw)
      .replace(/<[^>]*>/g, ' ')
      .replace(FORMAT_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!text || text.length > MAX_GLOSS_CHARS || text.split(' ').length > MAX_GLOSS_WORDS) return undefined;
  return text;
}

/** Normalized sense label (the cache key with the lemma); a missing label becomes "main". */
export function cleanSense(raw: unknown): string {
  if (typeof raw !== 'string') return 'main';
  const label = raw
    .replace(/[\p{Cc}\p{Cf}<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_SENSE_CHARS)
    .trim();
  return label || 'main';
}

/**
 * Parses an answer into per-id results. Ids outside the request are ignored; an item whose gloss breaks the caps is
 * left out, so the caller retries it. Throws when the answer has no usable JSON at all.
 */
export function parseGlossAnswer(text: string, requested: ReadonlySet<string>): Map<string, GlossAnswer> {
  const json = extractJson(text) as { items?: unknown } | unknown[] | null;
  const list = Array.isArray(json) ? json : json?.items;
  if (!Array.isArray(list)) throw new Error('model answer has no "items" array');
  const out = new Map<string, GlossAnswer>();
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : undefined;
    if (!id || !requested.has(id) || out.has(id)) continue;
    if (item.skip === true) {
      out.set(id, { skip: true });
      continue;
    }
    const gloss = cleanGloss(item.gloss);
    if (gloss) out.set(id, { skip: false, sense: cleanSense(item.sense), gloss });
  }
  return out;
}
