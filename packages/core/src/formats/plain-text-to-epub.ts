import { NS } from '../dom/xml-dom-helpers';
import { detectTextLanguage } from '../lang/detect-language';
import type { DomEnv } from '../types';
import { type BlockRenderer, buildTextBook, chunkChapters, decodeTextFile, type TextChapter, textElement, titleFromFileName } from './text-book';

/** A paragraph of the text file: its lines and the number of blank lines before it. */
interface RawParagraph {
  lines: string[];
  blankBefore: number;
}

const NUMBER = String.raw`(?:\d{1,4}|[ivxlcdm]{1,8}|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)(?:[\s-]+[a-z]+)?)`;
const KEYWORD = `(?:chapter|part|book|volume|section|chương|phần|hồi|quyển|kapitel|teil|chapitre|partie|livre|capítulo|parte|libro|capitolo|глава|часть|hoofdstuk|rozdział)`;
const STANDALONE = `(?:prologue|epilogue|preface|foreword|introduction|afterword|lời nói đầu|lời tựa|vĩ thanh)`;
/** "Chapter 12", "CHAPTER IV. The Pool", "Part One", "Prologue", "第三章 ..." and the like. */
const CHAPTER_LINE = new RegExp(
  String.raw`^(?:${KEYWORD}\s+${NUMBER}\b.{0,100}|${STANDALONE}\b.{0,60}|第[0-9一二三四五六七八九十百千零〇两]+[章回节卷部篇].{0,40})$`,
  'iu',
);
/** A bare upper-case roman numeral or number on its own line ("IV", "XII.", "7"). Upper case only: "Mix" is a word. */
const NUMBER_LINE = /^(?:[IVXLCDM]{1,8}|\d{1,3})\.?$/u;
/** Sentence-final or clause punctuation that a title line does not end with. */
const SENTENCE_END = /[.,;:!?…"”’'»)\]-]$/u;
const MAX_TITLE_CHARS = 100;
/** Lines of a verse paragraph are kept apart; prose lines (hard-wrapped text) are joined. */
const VERSE_LINE_CHARS = 45;

function splitParagraphs(text: string): RawParagraph[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/u, ''));
  const hasBlankLine = lines.some((l, i) => l.trim() === '' && i > 0 && i < lines.length - 1);
  const paragraphs: RawParagraph[] = [];
  let current: string[] = [];
  let blanks = 0;
  const flush = () => {
    if (current.length) paragraphs.push({ lines: current, blankBefore: blanks });
    current = [];
  };
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) {
        flush();
        blanks = 0;
      }
      blanks++;
      continue;
    }
    current.push(line.trim());
    // Without any blank line, every line is a paragraph of its own (one-paragraph-per-line files).
    if (!hasBlankLine) {
      flush();
      blanks = 0;
    }
  }
  flush();
  return paragraphs;
}

const singleLine = (p: RawParagraph | undefined): string | undefined =>
  p && p.lines.length === 1 && (p.lines[0] as string).length <= MAX_TITLE_CHARS ? p.lines[0] : undefined;

const isChapterLine = (p: RawParagraph) => {
  const line = singleLine(p);
  return line !== undefined && (CHAPTER_LINE.test(line) || NUMBER_LINE.test(line));
};

/** A short line set off by two or more blank lines and not ending like a sentence: a heading in many plain-text books. */
const isSpacedTitle = (p: RawParagraph) => {
  const line = singleLine(p);
  return line !== undefined && p.blankBefore >= 2 && !SENTENCE_END.test(line);
};

/** Indexes of the chapter headings: explicit chapter lines when there are two or more, else spaced title lines. */
function findHeadings(paragraphs: RawParagraph[]): number[] {
  const explicit = paragraphs.flatMap((p, i) => (isChapterLine(p) ? [i] : []));
  if (explicit.length >= 2) return explicit;
  const spaced = paragraphs.flatMap((p, i) => (i > 0 && i < paragraphs.length - 1 && isSpacedTitle(p) ? [i] : []));
  return spaced.length >= 2 ? spaced : [];
}

/** A short title-like line right after a chapter heading ("CHAPTER I." then "Down the Rabbit-Hole") is its subtitle. */
function subtitleOf(next: RawParagraph | undefined): string | undefined {
  const line = singleLine(next);
  if (!line || !next || line.length > 60 || SENTENCE_END.test(line) || !/^[\p{Lu}\p{N}]/u.test(line) || isChapterLine(next)) return undefined;
  return line;
}

function paragraphBlock(p: RawParagraph): BlockRenderer {
  const verse = p.lines.length > 1 && p.lines.every((l) => l.length <= VERSE_LINE_CHARS);
  if (!verse) return textElement('p', p.lines.join(' ').replace(/\s+/g, ' '));
  return (doc) => {
    const el = doc.createElementNS(NS.XHTML, 'p');
    p.lines.forEach((line, i) => {
      if (i > 0) el.appendChild(doc.createElementNS(NS.XHTML, 'br'));
      el.appendChild(doc.createTextNode(line));
    });
    return el;
  };
}

function headingBlock(title: string, subtitle: string | undefined): BlockRenderer {
  return (doc) => {
    const h = doc.createElementNS(NS.XHTML, 'h2');
    h.appendChild(doc.createTextNode(title));
    if (subtitle) {
      h.appendChild(doc.createElementNS(NS.XHTML, 'br'));
      h.appendChild(doc.createTextNode(subtitle));
    }
    return h;
  };
}

/**
 * Converts a plain-text book into an EPUB 3 package. Paragraphs are separated by blank lines (or are single lines
 * when the file has no blank line); hard-wrapped lines are joined, short verse lines kept apart. Chapters start at lines
 * such as "Chapter 3", "CHAPTER IV.", "Part One", "Prologue" or a bare roman numeral, else at short lines set off by two
 * blank lines, else the text is cut into chunks of about 40 paragraphs. The title is a short first line before the first
 * chapter, else the file name.
 */
export function plainTextToEpub(bytes: Uint8Array, fileName: string, env: DomEnv): Uint8Array {
  const paragraphs = splitParagraphs(decodeTextFile(bytes));
  if (paragraphs.length === 0) throw new Error('No translatable text found in this book');
  const headings = findHeadings(paragraphs);
  const firstLine = headings[0] !== 0 ? singleLine(paragraphs[0]) : undefined;
  const leadingTitle = firstLine !== undefined && paragraphs.length > 1 && !SENTENCE_END.test(firstLine) ? firstLine : undefined;
  const title = leadingTitle ?? titleFromFileName(fileName);

  let chapters: TextChapter[];
  if (headings.length === 0) {
    const blocks = paragraphs.map((p, i) => (i === 0 && leadingTitle ? textElement('h1', leadingTitle) : paragraphBlock(p)));
    chapters = chunkChapters(blocks);
  } else {
    const front = paragraphs.slice(0, headings[0]).map((p, i) => (i === 0 && leadingTitle ? textElement('h1', leadingTitle) : paragraphBlock(p)));
    chapters = front.length ? [{ title: '', blocks: front }] : [];
    headings.forEach((start, h) => {
      const end = headings[h + 1] ?? paragraphs.length;
      const heading = singleLine(paragraphs[start]) as string;
      const subtitle = start + 1 < end ? subtitleOf(paragraphs[start + 1]) : undefined;
      const bodyStart = start + (subtitle ? 2 : 1);
      chapters.push({
        title: subtitle ? `${heading} ${subtitle}` : heading,
        blocks: [headingBlock(heading, subtitle), ...paragraphs.slice(bodyStart, end).map(paragraphBlock)],
      });
    });
  }
  const language = detectTextLanguage(paragraphs.map((p) => p.lines.join(' ')));
  return buildTextBook({ title, language, chapters }, env);
}
