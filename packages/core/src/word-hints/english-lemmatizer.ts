import { ENGLISH_IRREGULAR_FORMS } from './english-irregular-forms';

/** Shortest stem a suffix rule may leave ("bed" must not become "b"). */
const MIN_STEM = 3;
/** A base form must not be far rarer than the word itself: "ceiling" is not a form of "ceil", "united" not of "unite". */
const MAX_RARER_FACTOR = 4;
const VOWEL = /[aeiouy]/;
const DOUBLED = /([bdfgklmnprtvz])\1$/;
/** Consonant, one vowel, consonant: "hat" in "hated" came from "hate" (otherwise it would be "hatted"). */
const SHORT_SYLLABLE = /(^|[^aeiou])[aeiou][^aeiouwxy]$/;
const SIBILANT = /(s|x|z|ch|sh|o)$/;

/** Candidate base forms of a lowercase word, most likely first. */
function candidates(word: string): string[] {
  const out: string[] = [];
  const stemOf = (suffix: string) => {
    if (!word.endsWith(suffix)) return undefined;
    const stem = word.slice(0, -suffix.length);
    return stem.length >= MIN_STEM - 1 && VOWEL.test(stem) ? stem : undefined;
  };
  /** -ed, -ing: doubled consonant first ("stopped"), then silent e for a short syllable ("hated"), else the bare stem. */
  const verbal = (suffix: string) => {
    const stem = stemOf(suffix);
    if (!stem) return;
    if (DOUBLED.test(stem)) out.push(stem.slice(0, -1));
    if (SHORT_SYLLABLE.test(stem)) out.push(`${stem}e`, stem);
    else out.push(stem, `${stem}e`);
  };
  for (const [suffix, end] of [
    ['ying', 'ie'],
    ['ies', 'y'],
    ['ied', 'y'],
    ['iest', 'y'],
    ['ier', 'y'],
  ] as const) {
    // "cried" → "cry": the stem alone may have no vowel, the base form has one.
    if (word.endsWith(suffix) && word.length > suffix.length) out.push(word.slice(0, -suffix.length) + end);
  }
  const ves = stemOf('ves');
  if (ves) out.push(`${ves}f`, `${ves}fe`);
  if (!/(ss|us|is|ous)$/.test(word)) {
    const es = stemOf('es');
    if (es && SIBILANT.test(es)) out.push(es);
    const s = stemOf('s');
    if (s) out.push(s);
  }
  verbal('ed');
  verbal('ing');
  return out.filter((c) => c.length >= MIN_STEM && c !== word);
}

/**
 * Rule-based English lemmatizer for hint grouping and difficulty: irregular forms from a table, then suffix rules
 * (-s/-es/-ies, -ed/-ied, -ing, -ier/-iest, consonant doubling, silent e) whose result must be a listed word.
 * Plain -er/-est are left alone: too many words only look like comparatives ("bitter", "forest").
 * `rank` returns the frequency rank of a listed word (undefined when unlisted). Unknown words are their own lemma.
 * This is deliberately small: derivations (-ly, -ness), compounds and rare irregular forms are not handled.
 */
export function lemmatizeEnglish(word: string, rank: (w: string) => number | undefined): string {
  const lower = word.toLowerCase().replace(/’/g, "'");
  const irregular = ENGLISH_IRREGULAR_FORMS.get(lower);
  if (irregular) return irregular;
  const own = rank(lower);
  for (const candidate of candidates(lower)) {
    const r = rank(candidate);
    if (r === undefined) continue;
    if (own !== undefined && own * MAX_RARER_FACTOR < r) continue;
    return candidate;
  }
  return lower;
}
