/**
 * Chapter headings of a plain-text book: explicit chapter lines ("Chapter 3", "CHAPTER IV.", "Part One", "Prologue",
 * bare numbers, "第三章"), else short lines set off by two blank lines. The rules keep sentences that merely start
 * with a chapter keyword, and the page numbers of scanned books, from becoming headings.
 */

/** A paragraph of the text file: its lines and the number of blank lines before it. */
export interface RawParagraph {
  lines: string[];
  blankBefore: number;
}

const NUMBER_WORD = `(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)`;
const NUMBER_UNIT = `(?:one|two|three|four|five|six|seven|eight|nine|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)`;
const NUMBER = String.raw`(?:\d{1,4}|[ivxlcdm]{1,8}|${NUMBER_WORD}(?:[\s-]+${NUMBER_UNIT})?)`;
const KEYWORD = `(?:chapter|part|book|volume|section|chương|phần|hồi|quyển|kapitel|teil|chapitre|partie|livre|capítulo|parte|libro|capitolo|глава|часть|hoofdstuk|rozdział)`;
const STANDALONE = `(?:prologue|epilogue|preface|foreword|introduction|afterword|lời nói đầu|lời tựa|vĩ thanh)`;
/** "Chapter 12", "CHAPTER IV. The Pool", "Part One", "Prologue": the keyword, its number, and what follows. */
const KEYWORD_LINE = new RegExp(String.raw`^${KEYWORD}\s+(${NUMBER})\b(.{0,100})$`, 'iu');
const STANDALONE_LINE = new RegExp(String.raw`^${STANDALONE}\b(.{0,60})$`, 'iu');
const CJK_CHAPTER_LINE = /^第[0-9一二三四五六七八九十百千零〇两]+[章回节卷部篇].{0,40}$/u;
/** A bare upper-case roman numeral or number on its own line ("IV", "XII.", "7"). Upper case only: "Mix" is a word. */
const NUMBER_LINE = /^(?:[IVXLCDM]{1,8}|\d{1,3})\.?$/u;
/** Sentence-final or clause punctuation that a title line does not end with. */
export const SENTENCE_END = /[.,;:!?…"”’'»)\]-]$/u;
const MAX_TITLE_CHARS = 100;

export const singleLine = (p: RawParagraph | undefined): string | undefined =>
  p && p.lines.length === 1 && (p.lines[0] as string).length <= MAX_TITLE_CHARS ? p.lines[0] : undefined;

/** Punctuation a paragraph ends with when its last sentence is complete. */
const ENDS_SENTENCE = /[.!?…"”’'»)\]*_]$/u;

/** A title after a chapter keyword: nothing, punctuation, or words that do not end like a clause (and, after a number, start capitalized). */
function titleLikeRest(rest: string, capitalized: boolean): boolean {
  const words = rest.replace(/^[\s.:—–)-]+/u, '');
  return words === '' || (!/[.,;:]$/u.test(words) && !(capitalized && /^\p{Ll}/u.test(words)));
}

/** A line naming a chapter: "Chapter 12", "CHAPTER IV. The Pool", "Part One", "Prologue", "第三章 ...". */
function isKeywordLine(line: string | undefined): boolean {
  if (line === undefined) return false;
  if (CJK_CHAPTER_LINE.test(line)) return true;
  const standalone = STANDALONE_LINE.exec(line);
  if (standalone) return titleLikeRest(standalone[1] as string, false);
  const m = KEYWORD_LINE.exec(line);
  if (!m) return false;
  const number = m[1] as string;
  // Roman numerals count in upper case only: "Book did not arrive" is a sentence, not book DID.
  if (/^[ivxlcdm]+$/i.test(number) && number !== number.toUpperCase()) return false;
  return titleLikeRest(m[2] as string, true);
}

const isChapterLine = (p: RawParagraph) => {
  const line = singleLine(p);
  return line !== undefined && (isKeywordLine(line) || NUMBER_LINE.test(line));
};

/** A short line set off by two or more blank lines and not ending like a sentence: a heading in many plain-text books. */
const isSpacedTitle = (p: RawParagraph) => {
  const line = singleLine(p);
  return line !== undefined && p.blankBefore >= 2 && !SENTENCE_END.test(line);
};

/**
 * Indexes of the chapter headings: explicit chapter lines when there are two or more, else spaced title lines. A heading
 * is followed by the start of a paragraph, never by the rest of a sentence (a line starting in lower case). A bare
 * number also needs a complete sentence before it, and bare numbers count only when most of them qualify: the page
 * numbers of a scanned book fall mid-sentence most of the time, chapter numbers never do.
 */
export function findHeadings(paragraphs: RawParagraph[]): number[] {
  const keyword: number[] = [];
  const numbered: number[] = [];
  let numberLines = 0;
  paragraphs.forEach((p, i) => {
    const line = singleLine(p);
    if (line === undefined) return;
    const next = paragraphs[i + 1];
    const continued = next !== undefined && /^\p{Ll}/u.test(next.lines[0] as string);
    if (isKeywordLine(line)) {
      if (!continued) keyword.push(i);
      return;
    }
    if (!NUMBER_LINE.test(line)) return;
    numberLines++;
    const prev = paragraphs[i - 1];
    // After a complete sentence, a keyword heading ("PART ONE") or the book's title line.
    const afterSentence =
      prev === undefined || ENDS_SENTENCE.test(prev.lines.at(-1) as string) || isKeywordLine(singleLine(prev)) || (i === 1 && singleLine(prev) !== undefined);
    if (afterSentence && !continued) numbered.push(i);
  });
  const explicit = numbered.length * 2 >= numberLines ? [...keyword, ...numbered].sort((a, b) => a - b) : keyword;
  if (explicit.length >= 2) return explicit;
  const spaced = paragraphs.flatMap((p, i) => (i > 0 && i < paragraphs.length - 1 && isSpacedTitle(p) ? [i] : []));
  return spaced.length >= 2 ? spaced : [];
}

/** A short title-like line right after a chapter heading ("CHAPTER I." then "Down the Rabbit-Hole") is its subtitle. */
export function subtitleOf(next: RawParagraph | undefined): string | undefined {
  const line = singleLine(next);
  if (!line || !next || line.length > 60 || SENTENCE_END.test(line) || !/^[\p{Lu}\p{N}]/u.test(line) || isChapterLine(next)) return undefined;
  return line;
}
