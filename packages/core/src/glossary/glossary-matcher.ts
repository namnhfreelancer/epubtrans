import type { GlossaryEntry } from '../types';

/** Scripts written without spaces: a term matches as a plain substring there. */
const UNSPACED_SCRIPT = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A precompiled term: a cheap word-set check first, then the exact boundary-aware test. */
interface TermMatcher {
  needle: string;
  /** First word of the term; the text must contain it as a word (fast rejection). Absent for substring terms. */
  firstWord?: string;
  boundary?: RegExp;
}

interface CompiledEntry {
  entry: GlossaryEntry;
  term: TermMatcher;
  translation?: TermMatcher;
}

function compileTerm(raw: string): TermMatcher | undefined {
  const needle = normalize(raw).trim();
  if (!needle) return undefined;
  const firstWord = needle.match(WORD)?.[0];
  if (!firstWord || UNSPACED_SCRIPT.test(needle)) return { needle };
  return { needle, firstWord, boundary: new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{M}\\p{N}])`, 'u') };
}

/** Normalized text plus the set of its words, built once per text. */
class SearchText {
  readonly text: string;
  readonly words: Set<string>;
  constructor(raw: string) {
    this.text = normalize(raw);
    this.words = new Set(this.text.match(WORD));
  }
  has(m: TermMatcher): boolean {
    if (!m.boundary) return this.text.includes(m.needle);
    return this.words.has(m.firstWord as string) && m.boundary.test(this.text);
  }
}

/** Compiled glossaries, keyed by array identity: settings arrays are replaced (not mutated) on edit. */
const compiledCache = new WeakMap<readonly GlossaryEntry[], CompiledEntry[]>();

function compile(glossary: readonly GlossaryEntry[]): CompiledEntry[] {
  let compiled = compiledCache.get(glossary);
  if (!compiled) {
    compiled = [];
    for (const entry of glossary) {
      const term = compileTerm(entry.term);
      if (!term || !entry.translation.trim()) continue;
      const translation = compileTerm(entry.translation);
      compiled.push({ entry, term, ...(translation ? { translation } : {}) });
    }
    compiledCache.set(glossary, compiled);
  }
  return compiled;
}

/**
 * Glossary entries relevant to a batch: the term occurs in `sourceText` (case-insensitive; whole words
 * for space-separated scripts, so "Ann" does not match "Anne"; substring for CJK/Thai). For a review pass,
 * pass the draft translation too: entries whose term or translation occurs in it are included as well,
 * so the reviewer can check names the draft kept or rendered.
 */
export function selectGlossaryEntries(glossary: readonly GlossaryEntry[], sourceText: string, draftText?: string): GlossaryEntry[] {
  if (glossary.length === 0) return [];
  const source = new SearchText(sourceText);
  const draft = draftText ? new SearchText(draftText) : undefined;
  const out: GlossaryEntry[] = [];
  for (const c of compile(glossary)) {
    const relevant = source.has(c.term) || (draft !== undefined && (draft.has(c.term) || (c.translation !== undefined && draft.has(c.translation))));
    if (relevant) out.push(c.entry);
  }
  return out;
}
