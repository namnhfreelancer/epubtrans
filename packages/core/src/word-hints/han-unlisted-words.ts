/**
 * Unlisted Han words (Chinese words, Japanese kanji compounds). The zh/ja lists are only 30k deep, so a Han word they
 * lack is usually rare, but `Intl.Segmenter` also emits tokens the list's own segmenter splits: word + particle
 * (笑了), pronoun + word (我的), adverb + verb (都是). Those are compounds of known words, not rare words.
 */

/** Longest Han token split into parts; longer tokens (rare in practice) count as unsplittable. */
const MAX_SPLIT_CHARS = 12;

/**
 * Rank of an unlisted Han token read as a compound of listed words: over every split into two or more listed words,
 * the split whose rarest part is the most common, and that part's rank. Undefined when no such split exists (some
 * part is unlisted, as in 踌躇 = 踌 + 躇), so the token stays a rare word. 笑了 = 笑 + 了 gives the rank of 笑.
 */
export function hanCompoundRank(word: string, rank: (word: string) => number | undefined): number | undefined {
  const chars = Array.from(word);
  const n = chars.length;
  if (n < 2 || n > MAX_SPLIT_CHARS) return undefined;
  // best[i]: the lowest possible "rarest part" rank over splits of the first i characters.
  const best: (number | undefined)[] = [0];
  for (let end = 1; end <= n; end++) {
    let bestEnd: number | undefined;
    for (let start = 0; start < end; start++) {
      if (start === 0 && end === n) continue; // the whole token is the unlisted word itself
      const before = best[start];
      if (before === undefined) continue;
      const part = rank(chars.slice(start, end).join(''));
      if (part === undefined) continue;
      const worst = Math.max(before, part);
      if (bestEnd === undefined || worst < bestEnd) bestEnd = worst;
    }
    best.push(bestEnd);
  }
  return best[n];
}

/**
 * Frequent characters written differently in Traditional and Simplified Chinese, as [Traditional, Simplified] strings
 * of equal length. Only pairs whose Simplified form is not also an ordinary Traditional character (unlike 后/後, 里/裡,
 * 干/乾), so each hit is a script signal.
 */
const TRADITIONAL = '們這個說會來時為國對過還發學經與進樣關現點從頭見問開間門長東無氣實車書話動給認應該讓聽覺記處體電邊嗎歲錢爾';
const SIMPLIFIED = '们这个说会来时为国对过还发学经与进样关现点从头见问开间门长东无气实车书话动给认应该让听觉记处体电边吗岁钱尔';
const TRADITIONAL_SET = new Set(TRADITIONAL);
const SIMPLIFIED_SET = new Set(SIMPLIFIED);
/** Script markers sampled before deciding; a book reaches this within a few pages. */
const SCRIPT_SAMPLE_MARKERS = 2_000;

/**
 * True when Chinese text is written in Traditional characters, judged from a sample of characters whose two forms
 * differ (the first {@link SCRIPT_SAMPLE_MARKERS} found). The Chinese list is Simplified: in Traditional text most
 * words are missing from it, so "unlisted = rare" would mark nearly every word (我們, 覺得) as rare.
 */
export function isTraditionalChinese(texts: Iterable<string>): boolean {
  let traditional = 0;
  let simplified = 0;
  for (const text of texts) {
    for (const ch of text) {
      if (TRADITIONAL_SET.has(ch)) traditional++;
      else if (SIMPLIFIED_SET.has(ch)) simplified++;
      else continue;
      if (traditional + simplified >= SCRIPT_SAMPLE_MARKERS) return traditional > simplified;
    }
  }
  return traditional > simplified;
}
