/**
 * Character classes for glossary matching, without a Unicode regex per character: Unicode property regexes are
 * slow in JavaScriptCore (Safari, Bun), and matching runs over every word of a book for the cost estimate.
 */
export const LETTER = 1;
export const NUMBER = 2;
export const OTHER = 3;
export type CharClass = typeof LETTER | typeof NUMBER | typeof OTHER;

const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const DIGIT = /^\p{N}$/u;

/** Class per BMP code unit, filled by `classAt` on first sight (0 = not classified yet). */
const bmpClasses = new Uint8Array(0x10000);
const astralClasses = new Map<number, CharClass>();

const classify = (char: string): CharClass => (LETTER_OR_MARK.test(char) ? LETTER : DIGIT.test(char) ? NUMBER : OTHER);
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

function classifyCodePoint(cp: number): CharClass {
  let c = astralClasses.get(cp);
  if (c === undefined) {
    c = classify(String.fromCodePoint(cp));
    astralClasses.set(cp, c);
  }
  return c;
}

/**
 * Class of the character at code-unit index `i`: LETTER for letters and combining marks, NUMBER for digits, OTHER
 * otherwise. Both halves of a surrogate pair get the class of the whole character; a lone surrogate is OTHER.
 */
export function classAt(text: string, i: number): CharClass {
  const code = text.charCodeAt(i);
  if (code < 0xd800 || code > 0xdfff) {
    const c = bmpClasses[code] as number;
    if (c !== 0) return c as CharClass;
    const fresh = classify(String.fromCharCode(code));
    bmpClasses[code] = fresh;
    return fresh;
  }
  if (isHigh(code)) {
    const low = text.charCodeAt(i + 1);
    return isLow(low) ? classifyCodePoint(((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000) : OTHER;
  }
  const high = text.charCodeAt(i - 1);
  return isHigh(high) ? classifyCodePoint(((high - 0xd800) << 10) + (code - 0xdc00) + 0x10000) : OTHER;
}

/** Words (maximal runs of letters, marks and digits) of a text, and the separators around them. */
export interface WordScan {
  words: string[];
  /** `separators[i]` precedes `words[i]`; the last one follows the last word. Always `words.length + 1` entries. */
  separators: string[];
}

/** Splits `text` into words and separators; equivalent to matching /[\p{L}\p{M}\p{N}]+/gu. */
export function scanWords(text: string): WordScan {
  const words: string[] = [];
  const separators: string[] = [];
  let sepStart = 0;
  let wordStart = -1;
  // Both halves of a surrogate pair share a class, so stepping one code unit at a time is safe.
  for (let i = 0; i < text.length; i++) {
    if (classAt(text, i) !== OTHER) {
      if (wordStart < 0) {
        separators.push(text.slice(sepStart, i));
        wordStart = i;
      }
    } else if (wordStart >= 0) {
      words.push(text.slice(wordStart, i));
      wordStart = -1;
      sepStart = i;
    }
  }
  if (wordStart >= 0) {
    words.push(text.slice(wordStart));
    separators.push('');
  } else separators.push(text.slice(sepStart));
  return { words, separators };
}
