import { CJK_FUNCTION_CHARS } from './candidate-word-lists';
import { byCountThenTerm, OccurrenceCounter, type RawCandidate } from './occurrence-counter';

const CJK_RUN = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}ー々]+/gu;
const KANA_ONLY = /^[\p{sc=Hiragana}ー]+$/u;
const MAX_N = 4;

/**
 * Candidates for scripts written without spaces (Chinese, Japanese; Korean works acceptably): frequent
 * character n-grams of length 2–4. Longer n-grams are only counted when both of their shorter parts are
 * frequent (apriori pruning keeps memory bounded on long books). An n-gram that mostly occurs inside a
 * longer frequent one is dropped in favour of the longer one.
 */
export function extractCjkCandidates(paragraphs: readonly string[], maxCandidates: number): RawCandidate[] {
  const runs: { paragraph: number; offset: number; text: string }[] = [];
  let totalChars = 0;
  paragraphs.forEach((text, paragraph) => {
    for (const m of text.matchAll(CJK_RUN)) {
      runs.push({ paragraph, offset: m.index, text: m[0] });
      totalChars += m[0].length;
    }
  });
  const minCount = Math.max(3, Math.ceil(totalChars / 60_000));
  const levels: OccurrenceCounter[] = [];
  for (let n = 2; n <= MAX_N; n++) {
    const shorter = levels[levels.length - 1];
    const frequent = (g: string) => (shorter?.get(g) ?? 0) >= minCount;
    const counter = new OccurrenceCounter();
    for (const run of runs) {
      for (let i = 0; i + n <= run.text.length; i++) {
        const gram = run.text.slice(i, i + n);
        if (shorter && !(frequent(gram.slice(0, -1)) && frequent(gram.slice(1)))) continue;
        counter.add(gram, run.paragraph, run.offset + i);
      }
    }
    levels.push(counter);
  }

  const subsumed = new Set<string>();
  for (let level = 1; level < levels.length; level++) {
    const shorter = levels[level - 1] as OccurrenceCounter;
    for (const [gram, count] of (levels[level] as OccurrenceCounter).counts) {
      if (count < minCount) continue;
      for (const part of [gram.slice(0, -1), gram.slice(1)]) if (count >= 0.75 * shorter.get(part)) subsumed.add(part);
    }
  }
  const out: RawCandidate[] = [];
  for (const counter of levels) {
    for (const [term, count] of counter.counts) {
      if (count < minCount || subsumed.has(term) || KANA_ONLY.test(term)) continue;
      if (CJK_FUNCTION_CHARS.has(term[0] as string) || CJK_FUNCTION_CHARS.has(term[term.length - 1] as string)) continue;
      out.push({ term, count, positions: counter.positions.get(term) ?? [] });
    }
  }
  return out.sort(byCountThenTerm).slice(0, maxCandidates);
}
