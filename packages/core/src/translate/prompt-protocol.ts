import { selectGlossaryEntries } from '../glossary/glossary-matcher';
import type { GlossaryEntry, ProjectSettings, Segment } from '../types';
import { languageName } from './token-estimate';

/**
 * Translation protocol. The system prompt is a stable prefix (role, language pair, guideline, rules) that is
 * byte-identical for every batch of a run, so providers can cache it: Anthropic caches the marked system
 * block, and OpenAI-compatible endpoints with automatic prefix caching (OpenAI, DeepSeek, Gemini) reuse the
 * longest identical prefix. The glossary is therefore NOT in the system prompt: only the entries relevant to
 * a batch are sent, inside the user message, so a 400-entry glossary neither breaks the cache per batch nor
 * costs 400 entries of input on every request.
 * User message and expected answer are JSON: {"glossary":["term → translation (note)"],"segments":[{"id":"…","html":"…"}]}
 * (`glossary` only when some entry is relevant) and {"segments":[{"id":"…","html":"…"}]}.
 */
export function buildContextBlock(settings: ProjectSettings): string {
  return `Source language: ${languageName(settings.sourceLang)}
Target language: ${languageName(settings.targetLang)}

## Style guideline
${settings.guideline.trim() || '(none)'}`;
}

/** One glossary line: `term → translation (note)`. */
export const formatGlossaryEntry = (g: GlossaryEntry): string => `${g.term} → ${g.translation}${g.note ? ` (${g.note})` : ''}`;

const GLOSSARY_RULE = `- "glossary", when present, lists the book's fixed translations ("term → translation (note)") for terms that occur in these segments: always use them, inflected as the target grammar requires.`;

const MARKUP_RULES = `- "html" is an HTML fragment. Keep every tag exactly as in the source, with identical attributes, and keep the same number of tags. Only translate the text between tags; you may move tags to follow the target word order.
- Never translate or alter code, URLs, e-mail addresses or numbers in identifiers.
- Translate headings, titles and table-of-contents labels too.
- Answer with JSON only, no markdown fences, no commentary: {"segments":[{"id":"…","html":"…"}]} containing every input id exactly once.`;

export function buildTranslateSystemPrompt(settings: ProjectSettings): string {
  return `You are an expert literary and technical translator. Translate book segments into the target language with the fluency of a native author.

${buildContextBlock(settings)}

## Rules
- Input is JSON {"glossary":[…],"segments":[{"id":"…","html":"…"}]}; segments are consecutive passages of one book chapter, use them as context for each other.
${GLOSSARY_RULE}
${MARKUP_RULES}`;
}

export function buildReviewSystemPrompt(settings: ProjectSettings): string {
  return `You are a senior translation editor. Review draft translations of book segments against the source and return the improved final translation.

${buildContextBlock(settings)}

## Rules
- Input is JSON {"glossary":[…],"segments":[{"id":"…","source":"…","draft":"…"}]}. Fix mistranslations, omissions, unnatural phrasing, glossary and guideline violations. Return the draft unchanged when it is already good.
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

export const buildTranslateUserMessage = (segments: Segment[], glossary: readonly GlossaryEntry[] = []): string =>
  JSON.stringify({ ...withGlossary(glossary), segments: segments.map((s) => ({ id: s.id, html: s.sourceHtml })) });

export const buildReviewUserMessage = (segments: Segment[], glossary: readonly GlossaryEntry[] = []): string =>
  JSON.stringify({ ...withGlossary(glossary), segments: segments.map((s) => ({ id: s.id, source: s.sourceHtml, draft: s.translationHtml ?? '' })) });

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
