import type { GlossaryEntry } from '../types';
import { classAt, LETTER, scanWords } from './word-scanner';
import { foldText, normalizeSeparator, type TokenizedText, tokenize, type Vocabulary } from './word-vocabulary';

/** Scripts written without spaces: a term matches as a plain substring there. */
const UNSPACED_SCRIPT = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;

/**
 * Inflection tolerance. A term word of at least MIN_INFLECTED_WORD characters, written only in Latin, Cyrillic or
 * Greek letters (no digits), also matches the same word followed by up to MAX_SUFFIX more letters
 * (Horcrux → Horcruxes, altruist → altruists, Darcy → Darcys). When the term word ends in a vowel (or ь, й, ς),
 * that final letter may be replaced as well, as declension does (Анна → Анну, Anna → Annę, Νίκος → Νίκου):
 * the word then matches its stem without the final letter plus up to MAX_SUFFIX letters.
 * Shorter words, words with digits and other scripts match exactly, so "art" never matches "artist" and
 * "Name1" never matches "Name10". Over-inclusion only costs a few prompt tokens; a missed entry costs consistency.
 */
const MIN_INFLECTED_WORD = 4;
const MAX_SUFFIX = 3;
const INFLECTING_WORD = /^[\p{sc=Latin}\p{sc=Cyrillic}\p{sc=Greek}\p{M}]+$/u;
const REPLACEABLE_FINAL = /[aeiouyаеёиоуыэюяйьαεηιουωάέήίόύώς]$/u;

/** One word of a term: matches `stem` exactly, or (tolerant) `stem` plus up to MAX_SUFFIX letters. */
interface TermWord {
  stem: string;
  tolerant: boolean;
}

/** A precompiled term, matched on the word tokens of a text. */
interface TermMatcher {
  /** Normalized term, searched as a substring for unspaced scripts. */
  needle: string;
  unspaced: boolean;
  words: TermWord[];
  /** Separators between consecutive words (`words.length - 1` of them). */
  separators: string[];
  /** Non-word characters right before the first word and right after the last one ("." in "Mr."). */
  lead: string;
  trail: string;
  /** One word without lead or trail: matching the first word is matching the term. */
  simple: boolean;
}

function termWord(word: string): TermWord {
  if ([...word].length < MIN_INFLECTED_WORD || !INFLECTING_WORD.test(word)) return { stem: word, tolerant: false };
  return { stem: REPLACEABLE_FINAL.test(word) ? word.slice(0, -1) : word, tolerant: true };
}

function compileTerm(raw: string): TermMatcher | undefined {
  const needle = normalizeSeparator(foldText(raw)).trim();
  if (!needle) return undefined;
  const { words, separators } = scanWords(needle);
  if (UNSPACED_SCRIPT.test(needle) || words.length === 0) return { needle, unspaced: true, words: [], separators: [], lead: '', trail: '', simple: false };
  const lead = separators[0] as string;
  const trail = separators[words.length] as string;
  return {
    needle,
    unspaced: false,
    words: words.map(termWord),
    separators: separators.slice(1, -1),
    lead,
    trail,
    simple: words.length === 1 && !lead && !trail,
  };
}

function lettersOnly(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (classAt(text, i) !== LETTER) return false;
  return true;
}

/** True when `word` is an accepted form of the term word `w` (see the inflection rule). */
function wordMatches(w: TermWord, word: string): boolean {
  const extra = word.length - w.stem.length;
  if (extra < 0 || extra > (w.tolerant ? MAX_SUFFIX : 0) || !word.startsWith(w.stem)) return false;
  return lettersOnly(word, word.length - extra, word.length);
}

/**
 * Trie over the first-word stems of word terms. A node at `depth` code units lists the matchers whose first-word
 * stem ends there: `exact` ones need the text word to end there too, `tolerant` ones accept up to MAX_SUFFIX letters.
 */
interface TrieNode {
  depth: number;
  next: Map<number, TrieNode> | undefined;
  exact: number[] | undefined;
  tolerant: number[] | undefined;
}
const trieNode = (depth: number): TrieNode => ({ depth, next: undefined, exact: undefined, tolerant: undefined });

/** Lookup structures for one set of matchers (glossary terms, or their translations). */
interface MatcherIndex {
  matchers: (TermMatcher | undefined)[];
  trie: TrieNode;
  /** Unspaced matchers by the first character of their needle. */
  unspaced: Map<string, number[]>;
  /** Matchers whose first word accepts vocabulary word `id`, resolved on first sight: `lists[id]`. */
  candidates?: { vocabulary: Vocabulary; lists: (readonly number[] | undefined)[] };
}

function addMatcher(index: MatcherIndex, m: TermMatcher | undefined, position: number): void {
  index.matchers.push(m);
  if (!m) return;
  if (m.unspaced) {
    const first = String.fromCodePoint(m.needle.codePointAt(0) as number);
    const list = index.unspaced.get(first);
    if (list) list.push(position);
    else index.unspaced.set(first, [position]);
    return;
  }
  const first = m.words[0] as TermWord;
  let node = index.trie;
  for (let i = 0; i < first.stem.length; i++) {
    const code = first.stem.charCodeAt(i);
    node.next ??= new Map();
    let child = node.next.get(code);
    if (!child) {
      child = trieNode(i + 1);
      node.next.set(code, child);
    }
    node = child;
  }
  const kind = first.tolerant ? 'tolerant' : 'exact';
  const list = node[kind];
  if (list) list.push(position);
  else node[kind] = [position];
}

const NONE: readonly number[] = [];

/** Matchers whose first word accepts `word`: the stems along its trie path, filtered by what follows each stem. */
function firstWordCandidates(index: MatcherIndex, word: string): readonly number[] {
  let out: number[] | undefined;
  let node: TrieNode | undefined = index.trie;
  for (let i = 0; i < word.length && node; i++) {
    node = node.next?.get(word.charCodeAt(i));
    if (!node || (!node.exact && !node.tolerant)) continue;
    const extra = word.length - node.depth;
    if (extra === 0 && node.exact) out = [...(out ?? []), ...node.exact];
    if (node.tolerant && (extra === 0 || (extra <= MAX_SUFFIX && lettersOnly(word, node.depth, word.length)))) out = [...(out ?? []), ...node.tolerant];
  }
  return out ?? NONE;
}

function candidatesOf(index: MatcherIndex, vocabulary: Vocabulary): (readonly number[] | undefined)[] {
  if (index.candidates?.vocabulary !== vocabulary) index.candidates = { vocabulary, lists: [] };
  const { lists } = index.candidates;
  // Grown densely (never assigned far past the end) so the array stays a fast packed array.
  while (lists.length < vocabulary.words.length) lists.push(undefined);
  return lists;
}

/** Does the whole term occur at word token `i`, given that its first word matched there? */
function restMatches(m: TermMatcher, t: TokenizedText, i: number): boolean {
  const { words, separators } = t.vocabulary;
  const last = i + m.words.length - 1;
  if (last >= t.words.length) return false;
  for (let j = 1; j < m.words.length; j++) {
    if (separators[t.separators[i + j] as number] !== m.separators[j - 1]) return false;
    if (!wordMatches(m.words[j] as TermWord, words[t.words[i + j] as number] as string)) return false;
  }
  // A lead or trail must not be glued to another word: "Mr." does not match "mr.x".
  if (m.trail) {
    const sep = separators[t.separators[last + 1] as number] as string;
    if (!sep.startsWith(m.trail) || (sep.length === m.trail.length && last + 1 < t.words.length)) return false;
  }
  if (m.lead) {
    const sep = separators[t.separators[i] as number] as string;
    if (!sep.endsWith(m.lead) || (sep.length === m.lead.length && i > 0)) return false;
  }
  return true;
}

/**
 * Positions found by one match, deduplicated with per-glossary marks instead of a Set: `marks[p] === epoch` means
 * p is already in `list`. Matching is synchronous, so one scratch array per glossary is safe.
 */
class Hits {
  readonly list: number[] = [];
  constructor(
    private readonly marks: Uint32Array,
    private readonly epoch: number,
  ) {}
  has(p: number): boolean {
    return this.marks[p] === this.epoch;
  }
  add(p: number): void {
    this.marks[p] = this.epoch;
    this.list.push(p);
  }
}

/** A text prepared once for matching against any glossary. */
export interface PreparedText {
  raw: string;
  tokens: TokenizedText;
}

export const prepareText = (raw: string): PreparedText => ({ raw, tokens: tokenize(foldText(raw)) });

/** Adds to `out` the positions of `index` matchers that occur in the text. */
function collect(index: MatcherIndex, text: PreparedText, out: Hits): void {
  if (index.trie.next) {
    const { tokens } = text;
    const lists = candidatesOf(index, tokens.vocabulary);
    const { words } = tokens.vocabulary;
    for (let i = 0; i < tokens.words.length; i++) {
      const id = tokens.words[i] as number;
      let list = lists[id];
      if (list === undefined) {
        list = firstWordCandidates(index, words[id] as string);
        lists[id] = list;
      }
      for (const p of list) {
        if (out.has(p)) continue;
        const m = index.matchers[p] as TermMatcher;
        if (m.simple || restMatches(m, tokens, i)) out.add(p);
      }
    }
  }
  if (index.unspaced.size > 0) {
    const normalized = normalizeSeparator(foldText(text.raw));
    for (const [first, list] of index.unspaced) {
      if (!normalized.includes(first)) continue;
      for (const p of list) if (!out.has(p) && normalized.includes((index.matchers[p] as TermMatcher).needle)) out.add(p);
    }
  }
}

/** A glossary compiled for matching. `entries[i]` is the entry behind position `i` of both indexes. */
export interface CompiledGlossary {
  readonly entries: readonly GlossaryEntry[];
  readonly terms: MatcherIndex;
  readonly translations: MatcherIndex;
  /** Scratch for `Hits`. */
  readonly marks: Uint32Array;
  epoch: number;
}

const emptyIndex = (): MatcherIndex => ({ matchers: [], trie: trieNode(0), unspaced: new Map() });

/** Compiled glossaries, keyed by array identity: settings arrays are replaced (not mutated) on edit. */
const compiledCache = new WeakMap<readonly GlossaryEntry[], CompiledGlossary>();

/** Compiles (once per glossary array) the usable entries: a non-empty term and a non-empty translation. */
export function compileGlossary(glossary: readonly GlossaryEntry[]): CompiledGlossary {
  const cached = compiledCache.get(glossary);
  if (cached) return cached;
  const entries: GlossaryEntry[] = [];
  const terms = emptyIndex();
  const translations = emptyIndex();
  for (const entry of glossary) {
    const term = compileTerm(entry.term);
    if (!term || !entry.translation.trim()) continue;
    const position = entries.length;
    entries.push(entry);
    addMatcher(terms, term, position);
    addMatcher(translations, compileTerm(entry.translation), position);
  }
  const compiled: CompiledGlossary = { entries, terms, translations, marks: new Uint32Array(entries.length), epoch: 0 };
  compiledCache.set(glossary, compiled);
  return compiled;
}

/**
 * Positions (in `compiled.entries`, in no particular order) of the entries whose term occurs in `source`, plus, when
 * `draft` is given, those whose term or translation occurs in the draft.
 */
export function matchPrepared(compiled: CompiledGlossary, source: PreparedText, draft?: PreparedText): number[] {
  if (compiled.entries.length === 0) return [];
  if (compiled.epoch === 0xffffffff) {
    compiled.marks.fill(0);
    compiled.epoch = 0;
  }
  const hits = new Hits(compiled.marks, ++compiled.epoch);
  collect(compiled.terms, source, hits);
  if (draft) {
    collect(compiled.terms, draft, hits);
    collect(compiled.translations, draft, hits);
  }
  return hits.list;
}

/**
 * Glossary entries relevant to a batch: the term occurs in `sourceText` (case-insensitive; whole words with a short
 * inflectional ending for space-separated scripts, see the rule above, so "Ann" does not match "Anne"; substring
 * for CJK/Thai). For a review pass, pass the draft translation too: entries whose term or translation occurs in it
 * are included as well, so the reviewer can check names the draft kept or rendered.
 */
export function selectGlossaryEntries(glossary: readonly GlossaryEntry[], sourceText: string, draftText?: string): GlossaryEntry[] {
  if (glossary.length === 0) return [];
  const compiled = compileGlossary(glossary);
  return matchPrepared(compiled, prepareText(sourceText), draftText ? prepareText(draftText) : undefined)
    .sort((a, b) => a - b)
    .map((p) => compiled.entries[p] as GlossaryEntry);
}
