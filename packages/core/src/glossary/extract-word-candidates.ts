import { ENGLISH_STOPWORDS, NAME_CONNECTORS, TITLE_ABBREVIATIONS } from './candidate-word-lists';
import { byCountThenTerm, OccurrenceCounter, type RawCandidate } from './occurrence-counter';

/** A word, keeping inner apostrophes and hyphens: "O'Brien", "self-esteem". */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
const UPPER_START = /^\p{Lu}/u;
const HAS_LOWER = /\p{Ll}/u;
const NUMERIC = /^[\p{N}'’-]+$/u;
const ROMAN_NUMERAL = /^[IVXLCDM]+$/;
const POSSESSIVE = /'s$/i;
const WHITESPACE = /^\s+$/;
/** Punctuation between two words that starts a new sentence, clause or quotation. */
const SENTENCE_BREAK = /[.!?…:;"'‘“”„«»‹›()[\]{}—–]/;
/** Below this share of English stopwords the text is not English: its most frequent words become stopwords. */
const ENGLISH_SHARE = 0.2;
const DYNAMIC_STOPWORDS = 100;
const MIN_VOCABULARY_FOR_DYNAMIC_STOPWORDS = 1000;
/** Share of the candidate list reserved for proper names; phrases fill the rest. */
const NAME_QUOTA = 0.7;

interface Token {
  word: string;
  start: number;
}

/**
 * Candidates for space-separated scripts. Names: runs of capitalized words (with connectors such as "of"),
 * and single capitalized words that recur mid-sentence more often than in lowercase. Phrases: frequent
 * lowercase bigrams and trigrams that neither start nor end with a stopword. Scripts without letter case
 * (Arabic, Hebrew, Devanagari, ...) only yield phrases. One pass over the text; linear time.
 */
export function extractWordCandidates(paragraphs: readonly string[], maxCandidates: number): RawCandidate[] {
  const capMid = new OccurrenceCounter();
  const capStart = new OccurrenceCounter();
  const runs = new OccurrenceCounter();
  const bigrams = new OccurrenceCounter();
  const trigrams = new OccurrenceCounter();
  const lower = new Map<string, number>();
  let totalWords = 0;
  let englishWords = 0;
  const staticStop = (w: string) => w.length < 2 || ENGLISH_STOPWORDS.has(w);

  paragraphs.forEach((text, pi) => {
    if (!text) return;
    // A paragraph without lowercase letters (a heading in capitals) carries no capitalization signal.
    const caseless = !HAS_LOWER.test(text);
    let prevEnd = -1;
    let prevWord = '';
    let run: string[] = [];
    let pending: string[] = [];
    let runStart = 0;
    let runAtStart = false;
    let w1: Token | undefined;
    let w2: Token | undefined;
    const flush = () => {
      if (run.length === 1) (runAtStart ? capStart : capMid).add(run[0] as string, pi, runStart);
      else if (run.length > 1) runs.add(`${runAtStart ? '^' : ''}${run.join(' ')}`, pi, runStart);
      run = [];
      pending = [];
    };
    for (const m of text.matchAll(WORD)) {
      const start = m.index;
      const gap = prevEnd < 0 ? '' : text.slice(prevEnd, start);
      const titleJoin = gap.trim() === '.' && TITLE_ABBREVIATIONS.has(prevWord);
      const sentenceStart = prevEnd < 0 || (SENTENCE_BREAK.test(gap) && !titleJoin);
      const plainGap = WHITESPACE.test(gap);
      const word = m[0].replace(/’/g, "'");
      const lowerWord = word.toLowerCase();
      const numeric = NUMERIC.test(word);
      const capitalized = !caseless && !numeric && word.length > 1 && UPPER_START.test(word);
      prevEnd = start + m[0].length;
      prevWord = word;
      totalWords++;
      if (ENGLISH_STOPWORDS.has(lowerWord)) englishWords++;

      if (capitalized) {
        const name = word.replace(POSSESSIVE, '');
        if (run.length && (plainGap || titleJoin)) {
          if (titleJoin) run[run.length - 1] += '.';
          run.push(...pending, name);
          pending = [];
        } else {
          flush();
          run = [name];
          runStart = start;
          runAtStart = sentenceStart;
        }
        if (name !== word) flush(); // "Darcy's house": the name ends at the possessive
      } else if (run.length && plainGap && pending.length < 2 && NAME_CONNECTORS.has(lowerWord)) {
        pending.push(lowerWord);
      } else {
        flush();
        if (!numeric) lower.set(lowerWord, (lower.get(lowerWord) ?? 0) + 1);
      }

      // Phrases never span punctuation, numbers or mid-sentence capitalized words (those are names).
      if (!plainGap || numeric || (capitalized && !sentenceStart)) {
        w1 = w2 = undefined;
        if (numeric || (capitalized && !sentenceStart)) continue;
      }
      if (w1 && !staticStop(w1.word) && !staticStop(lowerWord)) bigrams.add(`${w1.word} ${lowerWord}`, pi, w1.start);
      if (w2 && w1 && !staticStop(w2.word) && !staticStop(lowerWord)) trigrams.add(`${w2.word} ${w1.word} ${lowerWord}`, pi, w2.start);
      w2 = w1;
      w1 = { word: lowerWord, start };
    }
    flush();
  });

  const dynamicStop = new Set<string>();
  if (totalWords > 0 && englishWords / totalWords < ENGLISH_SHARE) {
    // Only with a book-sized vocabulary: in a short text the most frequent words are its content words.
    const n = lower.size >= MIN_VOCABULARY_FOR_DYNAMIC_STOPWORDS ? DYNAMIC_STOPWORDS : 0;
    for (const [w] of [...lower].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)) dynamicStop.add(w);
  }
  const isStop = (w: string) => staticStop(w) || dynamicStop.has(w);

  const names = collectNames(capMid, capStart, runs, lower, isStop);
  const nameKeys = new Set(names.map((n) => n.term.toLowerCase()));
  const phrases = collectPhrases(bigrams, trigrams, Math.max(3, Math.ceil(totalWords / 40_000)), isStop).filter((p) => !nameKeys.has(p.term));
  return pickWithQuota(names, phrases, maxCandidates);
}

function collectNames(
  capMid: OccurrenceCounter,
  capStart: OccurrenceCounter,
  runs: OccurrenceCounter,
  lower: Map<string, number>,
  isStop: (w: string) => boolean,
): RawCandidate[] {
  const multi = new OccurrenceCounter();
  for (const key of runs.counts.keys()) {
    const atStart = key.startsWith('^');
    const tokens = (atStart ? key.slice(1) : key).split(' ');
    // "Then Harry" at a sentence start: "Then" is an ordinary word that also appears in lowercase.
    const first = (tokens[0] as string).toLowerCase();
    if (atStart && !first.endsWith('.') && (isStop(first) || lower.has(first))) tokens.shift();
    while (tokens.length && NAME_CONNECTORS.has(tokens[0] as string)) tokens.shift();
    while (tokens.length && NAME_CONNECTORS.has(tokens[tokens.length - 1] as string)) tokens.pop();
    if (tokens.length === 1) capMid.merge(runs, key, tokens[0] as string);
    else if (tokens.length > 1) multi.merge(runs, key, tokens.join(' '));
  }
  const out: RawCandidate[] = [];
  for (const [term, count] of multi.counts) if (count >= 2) out.push({ term, count, positions: multi.positions.get(term) ?? [] });
  for (const [term, mid] of capMid.counts) {
    const lc = term.toLowerCase();
    if (mid < 2 || (lower.get(lc) ?? 0) >= mid || isStop(lc) || ROMAN_NUMERAL.test(term)) continue;
    out.push({ term, count: mid + capStart.get(term), positions: capMid.positions.get(term) ?? [] });
  }
  return out.sort(byCountThenTerm);
}

function collectPhrases(bigrams: OccurrenceCounter, trigrams: OccurrenceCounter, minCount: number, isStop: (w: string) => boolean): RawCandidate[] {
  const endsOk = (term: string) => {
    const words = term.split(' ');
    return !isStop(words[0] as string) && !isStop(words[words.length - 1] as string);
  };
  const subsumed = new Set<string>();
  const out: RawCandidate[] = [];
  for (const [term, count] of trigrams.counts) {
    if (count < minCount || !endsOk(term)) continue;
    out.push({ term, count, positions: trigrams.positions.get(term) ?? [] });
    // "theory of natural selection" makes "natural selection" redundant when they mostly occur together.
    const [a, b, c] = term.split(' ');
    for (const part of [`${a} ${b}`, `${b} ${c}`]) if (count >= 0.75 * bigrams.get(part)) subsumed.add(part);
  }
  for (const [term, count] of bigrams.counts) {
    if (count < minCount || subsumed.has(term) || !endsOk(term)) continue;
    out.push({ term, count, positions: bigrams.positions.get(term) ?? [] });
  }
  return out.sort(byCountThenTerm);
}

/** Names first up to their quota, phrases next, then any remaining room goes back to names. */
export function pickWithQuota(names: RawCandidate[], phrases: RawCandidate[], max: number): RawCandidate[] {
  const nameCount = Math.min(names.length, Math.max(Math.ceil(max * NAME_QUOTA), max - phrases.length));
  const picked = [...names.slice(0, nameCount), ...phrases.slice(0, max - nameCount)];
  return picked.sort(byCountThenTerm);
}
