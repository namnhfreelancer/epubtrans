import { extractCjkCandidates } from './extract-cjk-candidates';
import { extractWordCandidates } from './extract-word-candidates';
import type { RawCandidate } from './occurrence-counter';

/** A possible glossary term found locally in the book, with its frequency and up to two context snippets. */
export interface GlossaryCandidate {
  term: string;
  count: number;
  snippets: string[];
}

export interface ExtractCandidatesOptions {
  /** Upper bound of returned candidates (default 800). */
  maxCandidates?: number;
}

export type CandidateScript = 'words' | 'cjk' | 'unsupported';

const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/gu;
/** Scripts written without spaces whose words cannot be found without a dictionary. */
const UNSPACED = /[\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/gu;
const LETTER = /\p{L}/gu;
const SAMPLE_CHARS = 200_000;
const DEFAULT_MAX_CANDIDATES = 800;

/** Decides how to look for terms, from a sample spread over the whole text. */
export function detectCandidateScript(paragraphs: readonly string[]): CandidateScript {
  const totalChars = paragraphs.reduce((n, p) => n + p.length, 0);
  const stride = Math.max(1, Math.ceil(totalChars / SAMPLE_CHARS));
  let letters = 0;
  let cjk = 0;
  let unspaced = 0;
  for (let i = 0; i < paragraphs.length; i += stride) {
    const text = paragraphs[i] as string;
    letters += text.match(LETTER)?.length ?? 0;
    cjk += text.match(CJK)?.length ?? 0;
    unspaced += text.match(UNSPACED)?.length ?? 0;
  }
  if (letters === 0) return 'unsupported';
  if (cjk / letters >= 0.3) return 'cjk';
  if (unspaced / letters >= 0.3) return 'unsupported';
  return 'words';
}

/**
 * Finds glossary candidates in the whole book without any model call: proper names and frequent phrases
 * for space-separated scripts, frequent character n-grams for Chinese/Japanese/Korean. Scripts written
 * without spaces and without a supported heuristic (Thai, Lao, Khmer, Burmese) yield no candidates.
 * Deterministic: the same text always gives the same list, sorted by frequency.
 */
export function extractGlossaryCandidates(paragraphs: readonly string[], opts: ExtractCandidatesOptions = {}): GlossaryCandidate[] {
  const max = Math.max(0, Math.floor(opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
  if (max === 0) return [];
  const script = detectCandidateScript(paragraphs);
  if (script === 'unsupported') return [];
  const cjk = script === 'cjk';
  const raw = cjk ? extractCjkCandidates(paragraphs, max) : extractWordCandidates(paragraphs, max);
  return raw.map((c) => ({ term: c.term, count: c.count, snippets: snippetsOf(paragraphs, c, cjk) }));
}

function snippetsOf(paragraphs: readonly string[], c: RawCandidate, cjk: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < c.positions.length; i += 2) {
    const text = paragraphs[c.positions[i] as number];
    if (text) out.push(snippet(text, c.positions[i + 1] as number, c.term.length, cjk));
  }
  return out;
}

/** About 70 characters on each side (30 for CJK), cut at word boundaries, with ellipses where text was cut. */
function snippet(text: string, offset: number, length: number, cjk: boolean): string {
  const radius = cjk ? 30 : 70;
  let start = Math.max(0, offset - radius);
  let end = Math.min(text.length, offset + length + radius);
  if (!cjk) {
    const afterSpace = text.indexOf(' ', start);
    if (start > 0 && afterSpace >= 0 && afterSpace < offset) start = afterSpace + 1;
    const beforeSpace = text.lastIndexOf(' ', end);
    if (end < text.length && beforeSpace > offset + length) end = beforeSpace;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
