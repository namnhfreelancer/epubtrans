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

type Rank = (w: string) => number | undefined;

/**
 * Strings the web corpus behind the list ranks as words although they are markup or URL debris (`&quot;` → "quot").
 * They are never a lemma and never a hint candidate.
 */
export const CORPUS_ARTIFACTS: ReadonlySet<string> = new Set([
  'quot',
  'amp',
  'nbsp',
  'apos',
  'mdash',
  'ndash',
  'hellip',
  'rsquo',
  'lsquo',
  'rdquo',
  'ldquo',
  'http',
  'https',
  'www',
  'html',
  'href',
]);

/** `a` is a listed word clearly more frequent than `b` (unlisted words lose to listed ones). */
const muchMoreFrequent = (a: string, b: string, rank: Rank) => {
  const ra = rank(a);
  const rb = rank(b);
  return ra !== undefined && (rb === undefined || ra * MAX_RARER_FACTOR < rb);
};

/** Candidate base forms of a lowercase word, most likely first. */
function candidates(word: string, rank: Rank): string[] {
  const out: string[] = [];
  const stemOf = (suffix: string) => {
    if (!word.endsWith(suffix)) return undefined;
    const stem = word.slice(0, -suffix.length);
    return stem.length >= MIN_STEM - 1 && VOWEL.test(stem) ? stem : undefined;
  };
  /**
   * -ed, -ing: doubled consonant first ("stopped"), then silent e for a short syllable ("hated"); otherwise the bare
   * stem, unless the e-form is listed and far more frequent ("quoting" → "quote", not the corpus junk "quot").
   */
  const verbal = (suffix: string) => {
    const stem = stemOf(suffix);
    if (!stem) return;
    if (DOUBLED.test(stem)) out.push(stem.slice(0, -1));
    const withE = `${stem}e`;
    if (SHORT_SYLLABLE.test(stem) || muchMoreFrequent(withE, stem, rank) || (rank(stem) === undefined && rank(withE) !== undefined)) out.push(withE, stem);
    else out.push(stem, withE);
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
  // Plurals and 3rd person: the plain -s form first ("graves" → "grave", "senses" → "sense", "motives" → "motive");
  // the -ves → f/fe and sibilant -es readings only when the plain form is unlisted or far rarer ("wolves" → "wolf",
  // "boxes" → "box", "potatoes" → "potato").
  const plain = /(ss|us|is|ous)$/.test(word) ? undefined : stemOf('s');
  const ves = stemOf('ves');
  const es = plain ? stemOf('es') : undefined;
  const others = [...(ves ? [`${ves}f`, `${ves}fe`] : []), ...(es && SIBILANT.test(es) ? [es] : [])];
  if (plain && !others.some((o) => muchMoreFrequent(o, plain, rank)) && rank(plain) !== undefined) out.push(plain, ...others);
  else out.push(...[...others].sort((a, b) => (rank(a) ?? Infinity) - (rank(b) ?? Infinity)), ...(plain ? [plain] : []));
  verbal('ed');
  verbal('ing');
  return out.filter((c) => c.length >= MIN_STEM && c !== word && !CORPUS_ARTIFACTS.has(c));
}

/**
 * Rule-based English lemmatizer for hint grouping and difficulty: irregular forms from a table, then suffix rules
 * (-s/-es/-ies/-ves, -ed/-ied, -ing, -ier/-iest, consonant doubling, silent e) whose result must be a listed word;
 * when two readings are listed, the plain one wins unless the other is far more frequent. Corpus debris such as
 * "quot" never counts as a word.
 * Plain -er/-est are left alone: too many words only look like comparatives ("bitter", "forest").
 * `rank` returns the frequency rank of a listed word (undefined when unlisted). Unknown words are their own lemma.
 * This is deliberately small: derivations (-ly, -ness), compounds and rare irregular forms are not handled.
 */
export function lemmatizeEnglish(word: string, rank: Rank): string {
  const lower = word.toLowerCase().replace(/’/g, "'");
  const irregular = ENGLISH_IRREGULAR_FORMS.get(lower);
  if (irregular) return irregular;
  const own = rank(lower);
  for (const candidate of candidates(lower, rank)) {
    const r = rank(candidate);
    if (r === undefined) continue;
    if (own !== undefined && own * MAX_RARER_FACTOR < r) continue;
    return candidate;
  }
  return lower;
}
