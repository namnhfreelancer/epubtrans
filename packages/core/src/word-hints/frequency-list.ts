/**
 * Word frequency rank lists for Word Wise hints, generated from wordfreq (data CC BY-SA 4.0) by
 * `scripts/generate-word-frequency-lists.ts`. One file per language (`data/wordfreq/<lang>.txt`): a `#` header
 * line, then one lowercase word per line, most frequent first, so the line number is the rank.
 * Core only parses the text; the web app fetches the files as static assets and the CLI reads them from disk.
 */

/** Source languages with a frequency list. Others (and Traditional Chinese, which the Simplified list does not cover) get no hints. */
export const WORD_HINT_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'nl', 'pl', 'sv', 'uk', 'cs', 'ja', 'zh', 'ko'] as const;
export type WordHintLanguage = (typeof WORD_HINT_LANGUAGES)[number];

/** Attribution required by the CC BY-SA 4.0 license of the frequency data. */
export const WORD_FREQUENCY_ATTRIBUTION = 'Word frequencies: wordfreq by Robyn Speer et al. (https://github.com/rspeer/wordfreq), data licensed CC BY-SA 4.0';

/** Rank given to words absent from a list: rarer than every listed word. */
export const UNLISTED_RANK = 1_000_000;

export interface FrequencyList {
  lang: WordHintLanguage;
  /** Number of ranked words. */
  size: number;
  /** 1-based rank of a lowercase word, or undefined when it is not listed. */
  rank(word: string): number | undefined;
}

/**
 * The frequency list language for a source language tag, or undefined when hints are not supported for it.
 * `zh-Hant`, `zh-TW`, `zh-HK` and `zh-MO` are unsupported: wordfreq's Chinese list is Simplified.
 */
export function wordHintLanguage(tag: string | undefined): WordHintLanguage | undefined {
  if (!tag || tag === 'auto') return undefined;
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return undefined;
  }
  const base = locale.language.toLowerCase();
  if (base === 'zh') {
    const script = locale.script ?? (locale.region && ['TW', 'HK', 'MO'].includes(locale.region) ? 'Hant' : undefined);
    if (script === 'Hant') return undefined;
  }
  return (WORD_HINT_LANGUAGES as readonly string[]).includes(base) ? (base as WordHintLanguage) : undefined;
}

/** Parses a rank list file. Throws when the text is not a list (for example an HTML error page served instead). */
export function parseFrequencyList(lang: WordHintLanguage, text: string): FrequencyList {
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const raw of text.split('\n')) {
    const word = raw.trim();
    if (!word || word.startsWith('#')) continue;
    if (word.startsWith('<')) throw new Error(`The ${lang} word frequency list is not a word list`);
    rank++;
    if (!ranks.has(word)) ranks.set(word, rank);
  }
  if (ranks.size < 100) throw new Error(`The ${lang} word frequency list is empty or truncated`);
  return { lang, size: ranks.size, rank: (word) => ranks.get(word) };
}
