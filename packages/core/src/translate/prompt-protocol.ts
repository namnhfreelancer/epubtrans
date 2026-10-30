import type { ProjectSettings, Segment } from '../types';
import { languageName } from './token-estimate';

/**
 * Translation protocol. The system prompt is a stable prefix (role, language pair, guideline,
 * glossary) followed by rules, so providers can cache it across batches. The user message and the
 * expected answer are JSON: {"segments":[{"id":"…","html":"…"}]}.
 */
export function buildContextBlock(settings: ProjectSettings): string {
  const glossary = settings.glossary.length
    ? settings.glossary.map((g) => `- ${g.term} → ${g.translation}${g.note ? ` (${g.note})` : ''}`).join('\n')
    : '(none)';
  return `Source language: ${languageName(settings.sourceLang)}
Target language: ${languageName(settings.targetLang)}

## Style guideline
${settings.guideline.trim() || '(none)'}

## Glossary (always use these translations)
${glossary}`;
}

const MARKUP_RULES = `- "html" is an HTML fragment. Keep every tag exactly as in the source, with identical attributes, and keep the same number of tags. Only translate the text between tags; you may move tags to follow the target word order.
- Never translate or alter code, URLs, e-mail addresses or numbers in identifiers.
- Translate headings, titles and table-of-contents labels too.
- Answer with JSON only, no markdown fences, no commentary: {"segments":[{"id":"…","html":"…"}]} containing every input id exactly once.`;

export function buildTranslateSystemPrompt(settings: ProjectSettings): string {
  return `You are an expert literary and technical translator. Translate book segments into the target language with the fluency of a native author.

${buildContextBlock(settings)}

## Rules
- Input is JSON {"segments":[{"id":"…","html":"…"}]}; segments are consecutive passages of one book chapter, use them as context for each other.
${MARKUP_RULES}`;
}

export function buildReviewSystemPrompt(settings: ProjectSettings): string {
  return `You are a senior translation editor. Review draft translations of book segments against the source and return the improved final translation.

${buildContextBlock(settings)}

## Rules
- Input is JSON {"segments":[{"id":"…","source":"…","draft":"…"}]}. Fix mistranslations, omissions, unnatural phrasing, glossary and guideline violations. Return the draft unchanged when it is already good.
${MARKUP_RULES}`;
}

export const buildTranslateUserMessage = (segments: Segment[]): string => JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: s.sourceHtml })) });

export const buildReviewUserMessage = (segments: Segment[]): string =>
  JSON.stringify({ segments: segments.map((s) => ({ id: s.id, source: s.sourceHtml, draft: s.translationHtml ?? '' })) });

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
