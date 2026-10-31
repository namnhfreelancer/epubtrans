import { extractJson } from '../translate/prompt-protocol';
import { languageName } from '../translate/token-estimate';
import type { WordHintSense } from '../types';

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

/** Plain-text gloss within the caps, or undefined when the model's text is unusable. */
export function cleanGloss(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’«»「」([]+|["'“”‘’«»「」)\].;,]+$/g, '')
    .trim();
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
