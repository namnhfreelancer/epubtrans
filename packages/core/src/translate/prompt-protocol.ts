import { selectGlossaryEntries } from '../glossary/glossary-matcher';
import type { GlossaryEntry, Project, ProjectSettings, Segment } from '../types';
import { oneLine, type PolishContext, type TranslateContext } from './read-only-context';
import { languageName } from './token-estimate';
import { craftSection } from './translation-craft-rules';

/**
 * Translation protocol. The system prompt is a stable prefix (role, book, language pair, fixed meaning-first and
 * target-language craft rules, guideline, protocol rules) that is byte-identical for every batch of a run, so
 * providers can cache it: Anthropic caches the marked system block, and OpenAI-compatible endpoints with automatic
 * prefix caching (OpenAI, DeepSeek, Gemini) reuse the longest identical prefix. Everything that varies per batch is
 * in the user message: the chapter title, read-only neighbouring passages (`read-only-context.ts`) and only the
 * glossary entries relevant to the batch, so a 400-entry glossary neither breaks the cache per batch nor costs 400
 * entries of input on every request.
 * Translate user message: {"chapter":"…","context":[{"source":"…","translation":"…"}],"glossary":["term → translation (note)"],"segments":[{"id":"…","html":"…"}]}
 * Polish user message: {"chapter":"…","context_before":["…"],"context_after":["…"],"glossary":[…],"segments":[{"id":"…","source":"…","draft":"…"}]}
 * (every key but `segments` only when it has content). Expected answer: {"segments":[{"id":"…","html":"…"}]}.
 */

/** The book a run translates; its title and author are stable per run, so they belong in the system prompt. */
export type PromptBook = Pick<Project, 'title' | 'author'>;

const MAX_BOOK_FIELD_CHARS = 200;

export function buildContextBlock(settings: ProjectSettings): string {
  return `${languagePair(settings)}

${guidelineSection(settings)}`;
}

const languagePair = (settings: ProjectSettings) => `Source language: ${languageName(settings.sourceLang)}
Target language: ${languageName(settings.targetLang)}`;

const guidelineSection = (settings: ProjectSettings) => `## Style guideline
${settings.guideline.trim() || '(none)'}`;

/** English name of the target language without its tag: "Vietnamese (vi)" → "Vietnamese". */
const targetName = (settings: ProjectSettings) => languageName(settings.targetLang).replace(/\s+\([^()]*\)$/, '');

function bookLine(book: PromptBook | undefined): string {
  const title = book?.title ? oneLine(book.title, MAX_BOOK_FIELD_CHARS) : '';
  if (!title) return '';
  const author = book?.author ? oneLine(book.author, MAX_BOOK_FIELD_CHARS) : '';
  return `Book: "${title}"${author ? ` by ${author}` : ''}.\n`;
}

/** One glossary line: `term → translation (note)`. */
export const formatGlossaryEntry = (g: GlossaryEntry): string => `${g.term} → ${g.translation}${g.note ? ` (${g.note})` : ''}`;

export const GLOSSARY_RULE = `- "glossary", when present, lists the book's chosen translations ("term → translation (note)") for terms that occur in these segments. Use the listed translation for each such term, adapting its grammar, inflection and word order so the sentence stays natural. Where a word is used in a different, ordinary sense than the entry means, translate it naturally instead of forcing the entry.`;

/** Never add or drop meaning; the A/B runs showed models adding adjectives ("thú vị", "mỹ mãn") when told to sound natural. */
const FIDELITY_RULE = `Never add or drop meaning: keep every fact, nuance, image and the author's tone. No embellishment: add no adjectives, intensifiers, flourishes or explanations the source does not have, and do not cut, soften or summarize anything.`;

const TAG_PLACEMENT_RULE = `Place each inline tag around the words of your text that carry the same meaning as in the source, even if that moves, reorders or shrinks the tagged span.`;

const MARKUP_RULES = `- Keep every tag of the source with identical attributes and the same number of tags; never add, drop or rename a tag.
- Never translate or alter code, URLs, e-mail addresses or numbers in identifiers.
- Translate headings, titles and table-of-contents labels too.
- Answer with JSON only, no markdown fences, no commentary: {"segments":[{"id":"…","html":"…"}]} containing every input segment id exactly once and nothing else.`;

export function buildTranslateSystemPrompt(settings: ProjectSettings, book?: PromptBook): string {
  const target = targetName(settings);
  return `You are an award-winning translator of books into ${target}. You translate meaning, voice and intent, never word by word. Your ${target} must read as if a skilled ${target} author had written it originally.

${bookLine(book)}${languagePair(settings)}

## How to translate
1. Read each segment together with its neighbours and the read-only "context", and understand what the author means before you write.
2. Write the segment as natural ${target} prose first. Within a segment you may merge, split or reorder sentences and clauses, change parts of speech, and add or drop connective words wherever that makes it sound native.
3. ${FIDELITY_RULE}
4. Only then put the markup back: "html" is one HTML fragment. ${TAG_PLACEMENT_RULE}

${craftSection(settings.targetLang, target)}

${guidelineSection(settings)}

## Rules
- Input is JSON {"chapter":"…","context":[{"source":"…","translation":"…"}],"glossary":[…],"segments":[{"id":"…","html":"…"}]}. "segments" are consecutive passages of one book chapter; translate every one of them.
- "chapter" (the chapter title) and "context" (the passages just before the first segment, with their translation when one exists) are read-only background for understanding and continuity. Never translate them and never include them in the answer.
${GLOSSARY_RULE}
${MARKUP_RULES}`;
}

/** The second pass: a native editor rewrites the drafts for natural style, using the source only to check meaning. */
export function buildPolishSystemPrompt(settings: ProjectSettings, book?: PromptBook): string {
  const target = targetName(settings);
  return `You are a senior ${target} literary editor. You receive book segments in their source language and their ${target} drafts. The drafts still read like a translation. Rewrite each draft so it reads as polished, natural ${target} written by a skilled native author, as if there were no original: improve rhythm, word choice, connectives and sentence structure, and remove every trace of source syntax and translationese.

${bookLine(book)}${languagePair(settings)}

## How to polish
1. Read the drafts in order as one continuous text, as a ${target} reader would, together with the read-only drafts around them.
2. Rewrite freely within each segment: reorder clauses, split or merge sentences, change parts of speech, drop or add implied subjects, replace calques with idiomatic phrasing. Change a draft wherever a phrase sounds translated; keep it only where a native editor would not touch it.
3. Use "source" only to check that the meaning is complete and accurate, and fix mistranslations and omissions. ${FIDELITY_RULE}
4. Apply the style guideline (register, forms of address) and the glossary.
5. Keep the markup: the answer "html" is one HTML fragment. ${TAG_PLACEMENT_RULE}

${craftSection(settings.targetLang, target)}

${guidelineSection(settings)}

## Rules
- Input is JSON {"chapter":"…","context_before":["…"],"context_after":["…"],"glossary":[…],"segments":[{"id":"…","source":"…","draft":"…"}]}. "segments" are consecutive passages of one book chapter; polish every one of them.
- "chapter" (the chapter title), "context_before" and "context_after" (the drafts just before and after these segments) are read-only background for flow and continuity. Never edit them and never include them in the answer.
${GLOSSARY_RULE}
${MARKUP_RULES}`;
}

/** Text of an HTML fragment with tags replaced by spaces (good enough for glossary matching). */
export const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ');

/** Glossary entries whose term occurs in the batch source (and, for a review, in the draft translations). */
export function batchGlossary(glossary: readonly GlossaryEntry[], segments: readonly Segment[], kind: 'translate' | 'review'): GlossaryEntry[] {
  if (glossary.length === 0) return [];
  const source = segments.map((s) => s.sourceText || stripTags(s.sourceHtml)).join('\n');
  const draft = kind === 'review' ? segments.map((s) => stripTags(s.translationHtml ?? '')).join('\n') : undefined;
  return selectGlossaryEntries(glossary, source, draft);
}

const withGlossary = (glossary: readonly GlossaryEntry[]) => (glossary.length ? { glossary: glossary.map(formatGlossaryEntry) } : {});

export const buildTranslateUserMessage = (segments: Segment[], glossary: readonly GlossaryEntry[] = [], context: TranslateContext = {}): string =>
  JSON.stringify({ ...context, ...withGlossary(glossary), segments: segments.map((s) => ({ id: s.id, html: s.sourceHtml })) });

export const buildPolishUserMessage = (segments: Segment[], glossary: readonly GlossaryEntry[] = [], context: PolishContext = {}): string =>
  JSON.stringify({
    ...context,
    ...withGlossary(glossary),
    segments: segments.map((s) => ({ id: s.id, source: s.sourceHtml, draft: s.translationHtml ?? '' })),
  });

/** Extracts the JSON object from a model answer, tolerating code fences and surrounding prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('model answer contains no JSON');
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch (err) {
    throw new Error(`model answer is not valid JSON: ${(err as Error).message}`);
  }
}

/** Parses `{"segments":[{"id","html"}]}` (or a bare array) into id → html. */
export function parseSegmentsAnswer(text: string): Map<string, string> {
  const json = extractJson(text);
  const list = Array.isArray(json) ? json : (json as { segments?: unknown })?.segments;
  if (!Array.isArray(list)) throw new Error('model answer has no "segments" array');
  const out = new Map<string, string>();
  for (const item of list) {
    const { id, html } = (item ?? {}) as { id?: unknown; html?: unknown };
    if (typeof id === 'string' && typeof html === 'string' && !out.has(id)) out.set(id, html.trim());
  }
  return out;
}
