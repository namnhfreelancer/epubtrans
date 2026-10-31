import { NS } from '../dom/xml-dom-helpers';
import { detectTextLanguage } from '../lang/detect-language';
import { estimateTokens } from '../translate/token-estimate';
import type { DomEnv } from '../types';
import { findHeadings, type RawParagraph, SENTENCE_END, singleLine, subtitleOf } from './plain-text-headings';
import { MAX_SEGMENT_TOKENS, splitLongText } from './split-long-text';
import { type BlockRenderer, buildTextBook, chunkChapters, decodeTextFile, type TextChapter, textElement, titleFromFileName } from './text-book';

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

/** Consecutive lines grouped so that no group is longer than one segment may be. */
function lineGroups(lines: string[]): string[][] {
  const groups: string[][] = [[]];
  let tokens = 0;
  for (const line of lines) {
    // A line break costs about two tokens of markup.
    const lineTokens = estimateTokens(line) + 2;
    const group = groups.at(-1) as string[];
    if (group.length && tokens + lineTokens > MAX_SEGMENT_TOKENS) {
      groups.push([line]);
      tokens = lineTokens;
    } else {
      group.push(line);
      tokens += lineTokens;
    }
  }
  return groups;
}

/** One paragraph of the file as one or more `p` elements (a paragraph too long for one segment is split). */
function paragraphBlocks(p: RawParagraph): BlockRenderer[] {
  const verse = p.lines.length > 1 && p.lines.every((l) => l.length <= VERSE_LINE_CHARS);
  if (!verse) return splitLongText(p.lines.join(' ').replace(/\s+/g, ' ')).map((text) => textElement('p', text));
  return lineGroups(p.lines).map((lines) => (doc) => {
    const el = doc.createElementNS(NS.XHTML, 'p');
    lines.forEach((line, i) => {
      if (i > 0) el.appendChild(doc.createElementNS(NS.XHTML, 'br'));
      el.appendChild(doc.createTextNode(line));
    });
    return el;
  });
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
 * when the file has no blank line); hard-wrapped lines are joined, short verse lines kept apart, and a paragraph too long
 * for one segment is split at sentence ends. Chapters start at lines such as "Chapter 3", "CHAPTER IV.", "Part One",
 * "Prologue" or a bare roman numeral (see `findHeadings`), else at short lines set off by two blank lines, else the text
 * is cut into chunks of about 40 paragraphs. The title is a short first line before the first chapter, else the file name.
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
    const blocks = paragraphs.flatMap((p, i) => (i === 0 && leadingTitle ? [textElement('h1', leadingTitle)] : paragraphBlocks(p)));
    chapters = chunkChapters(blocks);
  } else {
    const front = paragraphs.slice(0, headings[0]).flatMap((p, i) => (i === 0 && leadingTitle ? [textElement('h1', leadingTitle)] : paragraphBlocks(p)));
    chapters = front.length ? [{ title: '', blocks: front }] : [];
    headings.forEach((start, h) => {
      const end = headings[h + 1] ?? paragraphs.length;
      const heading = singleLine(paragraphs[start]) as string;
      const subtitle = start + 1 < end ? subtitleOf(paragraphs[start + 1]) : undefined;
      const bodyStart = start + (subtitle ? 2 : 1);
      chapters.push({
        title: subtitle ? `${heading} ${subtitle}` : heading,
        blocks: [headingBlock(heading, subtitle), ...paragraphs.slice(bodyStart, end).flatMap(paragraphBlocks)],
      });
    });
  }
  const language = detectTextLanguage(paragraphs.map((p) => p.lines.join(' ')));
  return buildTextBook({ title, language, chapters }, env);
}
