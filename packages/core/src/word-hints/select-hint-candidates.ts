import { TOC_CHAPTER_TITLE } from '../import/import-book';
import type { GlossaryEntry, Project } from '../types';
import { lemmatizeEnglish } from './english-lemmatizer';
import { type FrequencyList, UNLISTED_RANK } from './frequency-list';
import { hintRankThreshold } from './hint-levels';
import { hintTextChunks, OccurrenceIndex, wordTokens } from './hint-text';

/** One occurrence of a candidate word: the `nth` occurrence of exactly `word` in segment `segmentId`. */
export interface HintCandidateOccurrence {
  segmentId: string;
  /** Index of the chapter in `project.chapters`. */
  chapter: number;
  word: string;
  nth: number;
  /** Eligible text of the segment and the word's position in it, for the sentence sent to the model. */
  text: string;
  start: number;
}

/** A lemma worth a hint at the requested level, with every occurrence in book order. */
export interface HintCandidate {
  lemma: string;
  rank: number;
  occurrences: HintCandidateOccurrence[];
}

export interface SelectHintCandidatesOptions {
  /** Hint level 1–5 (see `hint-levels.ts`). */
  level: number;
  /** Glossary of the book: its names (person, place, organization, or untyped capitalized terms) never get hints. */
  glossary?: readonly GlossaryEntry[];
}

const DIGIT = /\p{N}/u;
const LETTERS = /^[\p{L}\p{M}'’]+$/u;
const UPPER_START = /^\p{Lu}/u;
const LOWER_START = /^\p{Ll}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Punctuation between two words that may start a new sentence or clause (a capital after it is not a name signal). */
const SENTENCE_BREAK = /[.!?…:;"'‘“”„«»‹›()[\]{}—–]/;
const MIN_WORD_LENGTH = 3;
/** Unlisted words count as rare only from this length on (shorter ones are more likely abbreviations or typos). */
const MIN_UNLISTED_LENGTH = 4;
/** Languages that capitalize every noun: a capital letter says nothing about names there. */
const NOUN_CAPITALIZING = new Set(['de']);
const NAME_TYPES = new Set(['person', 'place', 'organization']);

interface WordInfo {
  key: string;
  lemma: string;
  rank: number;
  listed: boolean;
}

/** Lowercase words of glossary names (each word of "Duke of York"), which are never hinted. */
function glossaryNameWords(glossary: readonly GlossaryEntry[], lang: string): Set<string> {
  const words = new Set<string>();
  for (const g of glossary) {
    const named = g.type ? NAME_TYPES.has(g.type) : UPPER_START.test(g.term.trim());
    if (!named) continue;
    for (const t of wordTokens(g.term, lang)) words.add(normalize(t.word));
  }
  return words;
}

const normalize = (word: string) => word.toLowerCase().replace(/’/g, "'");

interface Pending {
  info: WordInfo;
  occurrence: HintCandidateOccurrence;
  /** Capitalized at a sentence start: dropped later when the book uses the word as a name. */
  sentenceInitialCapital: boolean;
}

/**
 * Picks the words of the original text that get a Word Wise hint at `level`, locally (no model call, linear time).
 * A word qualifies when its frequency rank (the better of its form and, for English, its lemma) is above the level's
 * threshold, or when it is absent from the list but written in lowercase in a cased script (a rare word rather than a
 * name). Skipped: numbers, words shorter than 3 letters (except CJK), glossary names, capitalized words in mid-sentence
 * (proper nouns; not in German, where every noun is capitalized), capitalized sentence starts that the book otherwise
 * uses as a name, unlisted words in caseless scripts, the table of contents, and text in code, math, ruby or sub/sup.
 */
export function selectHintCandidates(project: Project, list: FrequencyList, opts: SelectHintCandidatesOptions): HintCandidate[] {
  const lang = list.lang;
  const threshold = hintRankThreshold(opts.level);
  const names = glossaryNameWords(opts.glossary ?? [], lang);
  const nounCapitalizing = NOUN_CAPITALIZING.has(lang);
  const cache = new Map<string, WordInfo>();
  const seenLowercase = new Set<string>();
  const capitalizedMidSentence = new Set<string>();
  const pending: Pending[] = [];

  const infoOf = (lower: string): WordInfo => {
    let info = cache.get(lower);
    if (info) return info;
    const key = lang === 'en' ? lower.replace(/'s$/, '') : lower;
    const lemma = lang === 'en' ? lemmatizeEnglish(key, list.rank) : key;
    const own = list.rank(key);
    const base = lemma === key ? own : list.rank(lemma);
    const ranks = [own, base].filter((r): r is number => r !== undefined);
    info = { key, lemma, rank: ranks.length ? Math.min(...ranks) : UNLISTED_RANK, listed: ranks.length > 0 };
    cache.set(lower, info);
    return info;
  };

  project.chapters.forEach((chapter, chapterIndex) => {
    if (chapter.title === TOC_CHAPTER_TITLE) return;
    for (const segment of chapter.segments) {
      const chunks = hintTextChunks(segment.sourceHtml);
      const text = chunks.join('');
      const counter = new OccurrenceIndex();
      let offset = 0;
      let prevEnd = -1;
      for (const chunk of chunks) {
        for (const token of wordTokens(chunk, lang)) {
          const start = offset + token.index;
          const gap = prevEnd < 0 ? '' : text.slice(prevEnd, start);
          const sentenceStart = prevEnd < 0 || SENTENCE_BREAK.test(gap);
          prevEnd = start + token.word.length;
          const nth = counter.next(token.word);
          const word = token.word;
          if (DIGIT.test(word)) continue;
          const lower = normalize(word);
          const cjk = CJK.test(word);
          const cased = word !== lower || LOWER_START.test(word);
          const capital = UPPER_START.test(word);
          if (cased && !capital) seenLowercase.add(lang === 'en' ? lower.replace(/'s$/, '') : lower);
          if (!cjk && (word.length < MIN_WORD_LENGTH || !LETTERS.test(word))) continue;
          const info = infoOf(lower);
          if (names.has(info.key) || names.has(lower)) continue;
          if (capital && !nounCapitalizing && !sentenceStart) {
            capitalizedMidSentence.add(info.key);
            continue;
          }
          if (info.listed ? info.rank <= threshold : !cased || capital || word.length < MIN_UNLISTED_LENGTH) continue;
          pending.push({
            info,
            occurrence: { segmentId: segment.id, chapter: chapterIndex, word, nth, text, start },
            sentenceInitialCapital: capital && !nounCapitalizing,
          });
        }
        offset += chunk.length;
      }
    }
  });

  // English words missing from the list are lemmatized against the book's own words ("metacharities" → "metacharity").
  const bookLemma = new Map<string, string>();
  const lemmaOf = (info: WordInfo): string => {
    if (lang !== 'en' || info.listed || info.lemma !== info.key) return info.lemma;
    let lemma = bookLemma.get(info.key);
    if (lemma === undefined) {
      lemma = lemmatizeEnglish(info.key, (w) => (seenLowercase.has(w) ? 1 : undefined));
      bookLemma.set(info.key, lemma);
    }
    return lemma;
  };
  const byLemma = new Map<string, HintCandidate>();
  for (const p of pending) {
    // "Darcy" at a sentence start is still a name when the book also has it capitalized mid-sentence and never in lowercase.
    if (p.sentenceInitialCapital && capitalizedMidSentence.has(p.info.key) && !seenLowercase.has(p.info.key)) continue;
    const lemma = lemmaOf(p.info);
    let candidate = byLemma.get(lemma);
    if (!candidate) {
      candidate = { lemma, rank: p.info.rank, occurrences: [] };
      byLemma.set(lemma, candidate);
    }
    candidate.rank = Math.min(candidate.rank, p.info.rank);
    candidate.occurrences.push(p.occurrence);
  }
  return [...byLemma.values()];
}

const SENTENCE_END = /[.!?…。！？]/;
const MAX_CONTEXT = 240;

/**
 * The sentence around an occurrence, with the word marked as ⟦word⟧ so the model knows which one is meant even when
 * it occurs twice. Long sentences are cut to about 240 characters around the word.
 */
export function hintContext(occurrence: Pick<HintCandidateOccurrence, 'text' | 'start' | 'word'>): string {
  const { text, start, word } = occurrence;
  const end = start + word.length;
  let from = start;
  while (from > 0 && !(SENTENCE_END.test(text[from - 1] as string) && /\s/.test(text[from] ?? ' '))) from--;
  let to = end;
  while (to < text.length && !SENTENCE_END.test(text[to - 1] as string)) to++;
  const half = MAX_CONTEXT / 2;
  if (start - from > half) from = Math.max(from, text.lastIndexOf(' ', start - half) + 1);
  if (to - end > half) {
    const cut = text.indexOf(' ', end + half);
    to = cut < 0 ? to : Math.min(to, cut);
  }
  return `${text.slice(from, start)}⟦${word}⟧${text.slice(end, to)}`.replace(/\s+/g, ' ').trim();
}
