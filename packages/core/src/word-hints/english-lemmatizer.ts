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

/** What the book itself says about a word: written in lowercase somewhere, or present at all (any case). */
export interface BookWordEvidence {
  lowercase(word: string): boolean;
  present(word: string): boolean;
}

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

/**
 * List entries that are proper nouns only (the list is lowercased, so "Moore" reads as a word). They are never the base
 * form of a common word: "moored" is a form of "moor", "tampered" of "tamper", "ransomed" of "ransom". Found by lemmatizing
 * the top 100k list words and checking the base forms that are names.
 */
const PROPER_NOUN_ENTRIES: ReadonlySet<string> = new Set(['moore', 'tampere', 'ransome', 'busse', 'coe', 'abe', 'boe']);

/**
 * `a` is a listed word clearly more frequent than `b` (unlisted words lose to listed ones). Book evidence comes first:
 * a reading the book writes in lowercase beats one the book never contains, whatever the list says ("moored" in a book
 * that has "moor" but no "moore").
 */
const muchMoreFrequent = (a: string, b: string, rank: Rank, book?: BookWordEvidence) => {
  const ra = rank(a);
  if (ra === undefined) return false;
  if (book) {
    if (book.lowercase(b) && !book.present(a) && rank(b) !== undefined) return false;
    if (book.lowercase(a) && !book.present(b)) return true;
  }
  const rb = rank(b);
  return rb === undefined || ra * MAX_RARER_FACTOR < rb;
};

/** Candidate base forms of a lowercase word, most likely first. */
function candidates(word: string, rank: Rank, book?: BookWordEvidence): string[] {
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
    if (SHORT_SYLLABLE.test(stem) || muchMoreFrequent(withE, stem, rank, book) || (rank(stem) === undefined && rank(withE) !== undefined))
      out.push(withE, stem);
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
  // "boxes" → "box", "potatoes" → "potato"; a doubled final s/z is undoubled when the doubled form is unlisted:
  // "quizzes" → "quiz", but "caresses" → "caress").
  const plain = /(ss|us|is|ous)$/.test(word) ? undefined : stemOf('s');
  const ves = stemOf('ves');
  const es = plain ? stemOf('es') : undefined;
  const undoubled = es && rank(es) === undefined && /(ss|zz)$/.test(es) ? [es.slice(0, -1)] : [];
  const sibilant = es && SIBILANT.test(es) ? [es, ...undoubled] : [];
  const others = [...(ves ? [`${ves}f`, `${ves}fe`] : []), ...sibilant];
  if (plain && !others.some((o) => muchMoreFrequent(o, plain, rank, book)) && rank(plain) !== undefined) out.push(plain, ...others);
  else out.push(...[...others].sort((a, b) => (rank(a) ?? Infinity) - (rank(b) ?? Infinity)), ...(plain ? [plain] : []));
  verbal('ed');
  verbal('ing');
  return out.filter((c) => c.length >= MIN_STEM && c !== word && !CORPUS_ARTIFACTS.has(c) && !PROPER_NOUN_ENTRIES.has(c));
}

/**
 * Rule-based English lemmatizer for hint grouping and difficulty: irregular forms from a table, then suffix rules
 * (-s/-es/-ies/-ves, -ed/-ied, -ing, -ier/-iest, consonant doubling, silent e) whose result must be a listed word;
 * when two readings are listed, the plain one wins unless the other is far more frequent, or unless `book` shows that
 * the book writes one reading in lowercase and never uses the other. Corpus debris such as "quot" and list entries
 * that are only names ("moore") never count as base forms.
 * Plain -er/-est are left alone: too many words only look like comparatives ("bitter", "forest").
 * `rank` returns the frequency rank of a listed word (undefined when unlisted). Unknown words are their own lemma.
 * This is deliberately small: derivations (-ly, -ness), compounds and rare irregular forms are not handled.
 */
export function lemmatizeEnglish(word: string, rank: Rank, book?: BookWordEvidence): string {
  const lower = word.toLowerCase().replace(/’/g, "'");
  return ENGLISH_IRREGULAR_FORMS.get(lower) ?? acceptedReadings(lower, rank, book)[0] ?? lower;
}

/**
 * Every base form {@link lemmatizeEnglish} could pick for `word`, most likely first without book evidence. Book
 * evidence only reorders these, so a word with fewer than two readings has the same lemma whatever the book says.
 */
export function englishLemmaReadings(word: string, rank: Rank): string[] {
  const lower = word.toLowerCase().replace(/’/g, "'");
  const irregular = ENGLISH_IRREGULAR_FORMS.get(lower);
  return irregular ? [irregular] : acceptedReadings(lower, rank);
}

/** Listed candidate base forms of a lowercase word that are not far rarer than the word itself, in order. */
function acceptedReadings(lower: string, rank: Rank, book?: BookWordEvidence): string[] {
  const own = rank(lower);
  const accepted = candidates(lower, rank, book).filter((candidate) => {
    const r = rank(candidate);
    return r !== undefined && !(own !== undefined && own * MAX_RARER_FACTOR < r);
  });
  return [...new Set(accepted)];
}
