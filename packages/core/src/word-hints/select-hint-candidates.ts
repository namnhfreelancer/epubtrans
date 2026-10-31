import { TOC_CHAPTER_TITLE } from '../import/import-book';
import { isBackMatterTitle } from '../translate/translate-sample';
import type { GlossaryEntry, Project, WordHintSense } from '../types';
import { CORPUS_ARTIFACTS, lemmatizeEnglish } from './english-lemmatizer';
import { type FrequencyList, UNLISTED_RANK } from './frequency-list';
import { hintRankThreshold } from './hint-levels';
import { hintTextChunks, isGluedToken, OccurrenceIndex, wordTokens } from './hint-text';

/** One occurrence of a candidate word: the `nth` occurrence of exactly `word` in segment `segmentId`. */
export interface HintCandidateOccurrence {
  segmentId: string;
  /** Index of the chapter in `project.chapters`. */
  chapter: number;
  word: string;
  nth: number;
  /**
   * Frequency rank of this form (the better of the form and its lemma; UNLISTED_RANK when unlisted). Export shows the
   * occurrence only at levels whose threshold is below it, so each form appears exactly at the levels it qualifies for.
   */
  rank: number;
  /** Eligible text of the segment and the word's position in it, for the sentence sent to the model. */
  text: string;
  start: number;
}

/**
 * A lemma worth a hint at the requested level, with every occurrence of every form in book order: also the forms
 * too common for this level ("frustrating" next to a rare "frustrate"), so the stored glosses cover the lemma at
 * every level and changing the level later needs no new requests for it.
 */
export interface HintCandidate {
  lemma: string;
  /** Rank of the rarest form. */
  rank: number;
  /** Rank threshold of the level the candidate was selected for: occurrences above it are the ones that qualified. */
  threshold: number;
  occurrences: HintCandidateOccurrence[];
  /** Senses already glossed for the lemma: only these occurrences are missing, and they reuse or extend the senses. */
  senses?: WordHintSense[];
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
/** Han-only words (Chinese words, Japanese kanji compounds): an unlisted one of 2+ characters is a rare word. */
const HAN_WORD = /^\p{Script=Han}{2,}$/u;
/** Punctuation that ends a sentence: a capital after it is no name signal. */
const SENTENCE_END_GAP = /[.!?…。！？]/;
/**
 * Punctuation that may open a quotation, an aside or a list item (`: ; ( [ " ' “ ‘ « —`). A capital after it starts a
 * sentence only when the text before is not lowercase prose: in "wrote (Churchill" or "said: Graham" it is a name.
 */
const SOFT_BREAK_GAP = /[:;"'‘“”„«»‹›()[\]{}—–]/;
const MIN_WORD_LENGTH = 3;
/** Unlisted words count as rare only from this length on (shorter ones are more likely abbreviations or typos). */
const MIN_UNLISTED_LENGTH = 4;
/** A capitalized word the book never writes in lowercase is taken for a name once it occurs this often. */
const NAME_MIN_CAPITALIZED = 2;
/** Languages that capitalize every noun: a capital letter says nothing about names there. */
const NOUN_CAPITALIZING = new Set(['de']);
const NAME_TYPES = new Set(['person', 'place', 'organization']);

interface WordInfo {
  key: string;
  lemma: string;
  rank: number;
  listed: boolean;
  /** A form of this lemma can be above the threshold (the lemma is unlisted or rarer than the threshold). */
  possible: boolean;
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
  /** This occurrence alone would make its lemma a candidate (its form is rare enough). */
  qualifies: boolean;
  /** Capitalized where a sentence may start: dropped later when the book uses the word as a name. */
  sentenceInitialCapital: boolean;
}

/**
 * Picks the words of the original text that get a Word Wise hint at `level`, locally (no model call, linear time).
 * A word qualifies when its frequency rank (the better of its form and, for English, its lemma) is above the level's
 * threshold, or when it is absent from the list and is a lowercase word of a cased script or a Han word of 2+
 * characters (a rare word rather than a name). A qualifying lemma brings every occurrence of all its forms.
 * Skipped: numbers, words shorter than 3 letters (except CJK), corpus debris, glossary names, capitalized words in
 * mid-sentence (proper nouns; not in German, where every noun is capitalized), capitalized words the book never
 * writes in lowercase, other unlisted caseless words (single characters, kana, Korean word forms), tokens glued to a
 * letter across a tag (drop caps), the table of contents, back matter (index, notes, bibliography…), and text in
 * code, math, ruby, sub/sup, links and form controls.
 */
export function selectHintCandidates(project: Project, list: FrequencyList, opts: SelectHintCandidatesOptions): HintCandidate[] {
  const lang = list.lang;
  const threshold = hintRankThreshold(opts.level);
  const names = glossaryNameWords(opts.glossary ?? [], lang);
  const nounCapitalizing = NOUN_CAPITALIZING.has(lang);
  const cache = new Map<string, WordInfo>();
  const seenLowercase = new Set<string>();
  const capitalized = new Map<string, number>();
  const capitalizedMidSentence = new Set<string>();
  const pending: Pending[] = [];
  const keyOf = (lower: string) => (lang === 'en' ? lower.replace(/'s$/, '') : lower);

  const infoOf = (lower: string): WordInfo => {
    let info = cache.get(lower);
    if (info) return info;
    const key = keyOf(lower);
    const lemma = lang === 'en' ? lemmatizeEnglish(key, list.rank) : key;
    const own = list.rank(key);
    const base = lemma === key ? own : list.rank(lemma);
    const ranks = [own, base].filter((r): r is number => r !== undefined);
    const rank = ranks.length ? Math.min(...ranks) : UNLISTED_RANK;
    info = { key, lemma, rank, listed: ranks.length > 0, possible: base === undefined || base > threshold };
    cache.set(lower, info);
    return info;
  };

  project.chapters.forEach((chapter, chapterIndex) => {
    if (chapter.title === TOC_CHAPTER_TITLE || isBackMatterTitle(chapter.title)) return;
    for (const segment of chapter.segments) {
      const chunks = hintTextChunks(segment.sourceHtml);
      const text = chunks.map((c) => c.text).join('');
      const counter = new OccurrenceIndex();
      let offset = 0;
      let prevEnd = -1;
      let prevWord = '';
      for (const chunk of chunks) {
        for (const token of wordTokens(chunk.text, lang)) {
          const start = offset + token.index;
          const gap = prevEnd < 0 ? '' : text.slice(prevEnd, start);
          const sentenceStart = prevEnd < 0 || SENTENCE_END_GAP.test(gap) || (SOFT_BREAK_GAP.test(gap) && !LOWER_START.test(prevWord) && !DIGIT.test(prevWord));
          prevEnd = start + token.word.length;
          prevWord = token.word;
          const nth = counter.next(token.word);
          const word = token.word;
          if (DIGIT.test(word) || isGluedToken(chunk.text, chunk.glue, token)) continue;
          const lower = normalize(word);
          const cjk = CJK.test(word);
          const cased = word !== lower || LOWER_START.test(word);
          const capital = UPPER_START.test(word);
          if (cased && !capital) seenLowercase.add(keyOf(lower));
          if (!cjk && (word.length < MIN_WORD_LENGTH || !LETTERS.test(word))) continue;
          const info = infoOf(lower);
          if (!info.possible || CORPUS_ARTIFACTS.has(info.key) || names.has(info.key) || names.has(lower)) continue;
          if (capital && !nounCapitalizing) {
            capitalized.set(info.key, (capitalized.get(info.key) ?? 0) + 1);
            if (!sentenceStart) {
              capitalizedMidSentence.add(info.key);
              continue;
            }
          }
          const qualifies = info.listed ? info.rank > threshold : cased ? !capital && word.length >= MIN_UNLISTED_LENGTH : HAN_WORD.test(word);
          // Unlisted capitalized or short words never qualify on their own; they join a lemma written in lowercase elsewhere.
          if (!info.listed && !qualifies && !cased) continue;
          pending.push({
            info,
            occurrence: { segmentId: segment.id, chapter: chapterIndex, word, nth, rank: info.rank, text, start },
            qualifies,
            sentenceInitialCapital: capital && !nounCapitalizing,
          });
        }
        offset += chunk.text.length;
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
  const isName = (key: string) => !seenLowercase.has(key) && (capitalizedMidSentence.has(key) || (capitalized.get(key) ?? 0) >= NAME_MIN_CAPITALIZED);
  const byLemma = new Map<string, HintCandidate & { qualifies: boolean }>();
  for (const p of pending) {
    // "Darcy" at a sentence start is still a name when the book writes it capitalized elsewhere and never in lowercase.
    if (p.sentenceInitialCapital && isName(p.info.key)) continue;
    const lemma = lemmaOf(p.info);
    let candidate = byLemma.get(lemma);
    if (!candidate) {
      candidate = { lemma, rank: 0, threshold, occurrences: [], qualifies: false };
      byLemma.set(lemma, candidate);
    }
    candidate.qualifies ||= p.qualifies;
    if (p.qualifies) candidate.rank = Math.max(candidate.rank, p.occurrence.rank);
    candidate.occurrences.push(p.occurrence);
  }
  return [...byLemma.values()].filter((c) => c.qualifies).map(({ qualifies: _q, ...c }) => c);
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
