import { classAt, OTHER } from './word-scanner';

/** Case folding shared by glossary terms and texts. */
export const foldText = (text: string): string => text.normalize('NFC').toLowerCase();
/** Whitespace and apostrophe normalization that separators and unspaced terms are compared under. */
export const normalizeSeparator = (text: string): string => text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

/** Bounds the interned strings of a long session (many books, drafts); a full vocabulary is replaced by a new one. */
const MAX_WORDS = 500_000;
const MAX_SEPARATORS = 50_000;

/**
 * Interned words and (normalized) separators. A text is tokenized once into ids, and a glossary then resolves each
 * distinct word once instead of once per occurrence, which keeps re-matching a whole book cheap after a glossary edit.
 */
export class Vocabulary {
  readonly words: string[] = [];
  readonly separators: string[] = [];
  private readonly wordIds = new Map<string, number>();
  private readonly separatorIds = new Map<string, number>();

  get full(): boolean {
    return this.words.length >= MAX_WORDS || this.separators.length >= MAX_SEPARATORS;
  }

  wordId(word: string): number {
    let id = this.wordIds.get(word);
    if (id === undefined) {
      id = this.words.length;
      this.words.push(word);
      this.wordIds.set(word, id);
    }
    return id;
  }

  separatorId(raw: string): number {
    let id = this.separatorIds.get(raw);
    if (id === undefined) {
      const normalized = raw === '' || raw === ' ' ? raw : normalizeSeparator(raw);
      id = this.separators.length;
      this.separators.push(normalized);
      this.separatorIds.set(raw, id);
    }
    return id;
  }
}

/** A folded text as word and separator ids; `separators[i]` precedes `words[i]`, the last one is the tail. */
export interface TokenizedText {
  readonly vocabulary: Vocabulary;
  readonly words: Int32Array;
  readonly separators: Int32Array;
}

let shared = new Vocabulary();

/** Tokenizes `folded` (see `foldText`) against the shared vocabulary, in one pass without intermediate string arrays. */
export function tokenize(folded: string): TokenizedText {
  if (shared.full) shared = new Vocabulary();
  const vocabulary = shared;
  // A text of n code units has at most ceil(n / 2) words (each needs a separator after it but the last).
  const words = new Int32Array(Math.ceil(folded.length / 2));
  const separators = new Int32Array(words.length + 1);
  let count = 0;
  let sepStart = 0;
  let wordStart = -1;
  // Both halves of a surrogate pair share a class, so stepping one code unit at a time is safe.
  for (let i = 0; i < folded.length; i++) {
    if (classAt(folded, i) !== OTHER) {
      if (wordStart < 0) {
        separators[count] = vocabulary.separatorId(folded.slice(sepStart, i));
        wordStart = i;
      }
    } else if (wordStart >= 0) {
      words[count++] = vocabulary.wordId(folded.slice(wordStart, i));
      wordStart = -1;
      sepStart = i;
    }
  }
  if (wordStart >= 0) {
    words[count++] = vocabulary.wordId(folded.slice(wordStart));
    separators[count] = vocabulary.separatorId('');
  } else separators[count] = vocabulary.separatorId(folded.slice(sepStart));
  return { vocabulary, words: words.slice(0, count), separators: separators.slice(0, count + 1) };
}
