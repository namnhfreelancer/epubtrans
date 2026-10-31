import type { ProjectSettings } from '../types';
import { extractJson } from './prompt-protocol';
import { languageName } from './token-estimate';

/**
 * The generated guideline is a block that starts with this heading. Everything above it is the "base"
 * guideline (a preset or the user's own text), which generation never rewrites: a new generated block is
 * appended below the base, and regenerating replaces only the previous generated block.
 */
export const GENERATED_GUIDELINE_HEADING = '## Book-specific guideline';

export interface GuidelineSection {
  key: string;
  title: string;
  /** What the model must cover in this section. */
  ask: string;
}

/** Fixed sections of a generated guideline, in output order. */
export const GUIDELINE_SECTIONS: readonly GuidelineSection[] = [
  { key: 'genre', title: 'Genre & audience', ask: 'genre, period, intended readers and what the translation must preserve for them.' },
  { key: 'tone', title: 'Tone & register', ask: 'narrative voice, formality, sentence rhythm, humour or irony, archaic or modern diction.' },
  {
    key: 'address',
    title: 'Forms of address & pronouns',
    ask: 'how the main characters (or author and reader) address and refer to each other, as concrete target-language pronoun pairs per relationship, including changes over the story. For Vietnamese, give the xưng hô pair for each relationship (for example "Harry – Hermione: tớ – cậu", "narrator to reader: tôi – bạn") and the narrator\'s third-person pronouns (anh ấy, cô ấy, hắn, lão, …).',
  },
  {
    key: 'names',
    title: 'Names policy',
    ask: 'which names are kept as written, transliterated or translated (people, places, organizations, invented names, nicknames), with examples.',
  },
  {
    key: 'dialogue',
    title: 'Dialogue & quotation marks',
    ask: 'quotation-mark and dialogue-dash conventions of the target language, inner quotes, thoughts, letters.',
  },
  {
    key: 'honorifics',
    title: 'Honorifics & titles',
    ask: 'titles, ranks, honorifics and kinship terms (Mr, Lady, sensei, Sir, …): keep, translate or adapt, with examples.',
  },
  {
    key: 'numbers',
    title: 'Units, numbers & dates',
    ask: 'units of measure, currency, numerals, date and time formats: convert or keep, and number formatting.',
  },
  { key: 'headings', title: 'Chapter titles & headings', ask: 'how to render chapter titles, numbering, headings, epigraphs and the table of contents.' },
  {
    key: 'footnotes',
    title: 'Footnotes',
    ask: "how to translate the book's notes and references; whether translator notes are allowed (by default they are not).",
  },
  {
    key: 'untranslated',
    title: 'Keep untranslated',
    ask: 'words, phrases, quotations, foreign-language passages, code or titles that stay in the original, and how to mark them.',
  },
];

/** A level-1 or level-2 Markdown heading; the generated block itself only uses level-3 subsections. */
const TOP_HEADING = /^#{1,2}\s/;

/**
 * Splits a guideline into the base text and the previously generated block (if any). The generated block runs from
 * its heading to the next level-1/2 heading: a section the user added below it under such a heading is theirs and
 * counts as base text (so regenerating keeps it, above the new block).
 */
export function splitGuideline(guideline: string): { base: string; generated: string } {
  const lines = guideline.split('\n');
  const at = lines.findIndex((line) => line.trim() === GENERATED_GUIDELINE_HEADING);
  if (at < 0) return { base: guideline.trim(), generated: '' };
  const after = lines.findIndex((line, i) => i > at && TOP_HEADING.test(line.trim()));
  const end = after < 0 ? lines.length : after;
  const base = [lines.slice(0, at).join('\n').trim(), lines.slice(end).join('\n').trim()].filter(Boolean).join('\n\n');
  return { base, generated: lines.slice(at, end).join('\n').trim() };
}

/** Base guideline followed by the generated block, separated by a blank line. */
export function composeGuideline(base: string, generated: string): string {
  return [base.trim(), generated.trim()].filter(Boolean).join('\n\n');
}

export function buildGuidelineSystemPrompt(settings: ProjectSettings, base: string): string {
  const sections = GUIDELINE_SECTIONS.map((s) => `- "${s.key}" (${s.title}): ${s.ask}`).join('\n');
  const keys = GUIDELINE_SECTIONS.map((s) => `"${s.key}":"- …"`).join(',');
  return `You are a translation editor preparing a book translation. Study the passages, sampled from the whole book, and write a detailed, book-specific style guideline for the translator.

Source language: ${languageName(settings.sourceLang)}
Target language: ${languageName(settings.targetLang)}

## Base guideline (already in force)
${base || '(none)'}

## Sections to write
${sections}

## Rules
- Write each section as 2–8 short imperative bullet points ("- …"), concrete and specific to this book; quote source words and give the target-language rendering where it helps.
- Do not repeat the base guideline. When this book needs a different choice than a base rule, write "Override: …" in the relevant section.
- When the passages give no evidence for a section, write one bullet with the most sensible default for this genre and language pair.
- Write in English; quote target-language forms as they should appear.
- Answer with JSON only, no markdown fences: {"sections":{${keys}}}`;
}

/**
 * Renders the model answer as the generated guideline block: the fixed heading and every section in fixed
 * order (a missing section gets a "follow the base guideline" bullet). An answer with a single
 * `"guideline"` string is accepted as the block body.
 */
export function parseGuidelineAnswer(text: string): string {
  const json = extractJson(text) as { sections?: unknown; guideline?: unknown } | null;
  const sections = json && typeof json.sections === 'object' && json.sections !== null ? (json.sections as Record<string, unknown>) : undefined;
  if (sections) {
    const bodies = GUIDELINE_SECTIONS.map((s) => bulletText(sections[s.key]));
    if (bodies.some(Boolean)) {
      const parts = GUIDELINE_SECTIONS.map((s, i) => `### ${s.title}\n${bodies[i] || '- No book-specific rule; follow the base guideline.'}`);
      return `${GENERATED_GUIDELINE_HEADING}\n\n${parts.join('\n\n')}`;
    }
  }
  if (typeof json?.guideline === 'string' && json.guideline.trim()) return `${GENERATED_GUIDELINE_HEADING}\n\n${json.guideline.trim()}`;
  throw new Error('model answer has no guideline');
}

/** A section body as bullet lines; accepts a string or an array of strings. */
function bulletText(value: unknown): string {
  const lines = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' ? value.split('\n') : [];
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^[-*•]\s/.test(line) ? `- ${line.replace(/^[-*•]\s+/, '')}` : `- ${line}`))
    .join('\n');
}
