/** Han, Hiragana, Katakana and Hangul: roughly 1.5 characters per token. */
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

/** Number of CJK characters in `text`. */
export const countCjk = (text: string): number => text.match(CJK)?.length ?? 0;

/** Approximate token count: chars/4 for Latin-like scripts, chars/1.5 for CJK. */
export function estimateTokens(text: string): number {
  const cjk = countCjk(text);
  return Math.ceil((text.length - cjk) / 4 + cjk / 1.5);
}

let languageNames: Intl.DisplayNames | undefined;

/** Human-readable English name of a BCP 47 tag, e.g. 'vi' → 'Vietnamese'. */
export function languageName(tag: string): string {
  if (!tag || tag === 'auto' || tag === 'und') return 'the source language (detect it from the text)';
  try {
    languageNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
    const name = languageNames.of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}
