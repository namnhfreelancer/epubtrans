import { splitLongText } from './split-long-text';

/**
 * Block-level Markdown (the subset books use): ATX and setext headings, paragraphs, block quotes, flat bullet and
 * ordered lists, fenced code and thematic breaks (front matter is read by `markdown-front-matter.ts`). Raw HTML blocks and tables are kept as paragraph
 * text (inline rendering drops the tags). Indented text is a paragraph, not code: many plain-text books indent paragraphs.
 * The rules favour books over strict CommonMark: a file with (almost) no blank lines has one paragraph per line, as in
 * the plain-text importer, and a leading `---` is front matter only when what follows really is YAML.
 */
export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: MarkdownBlock[] }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'rule' };

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const BULLET = /^ {0,3}[-*+][ \t]+/;
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+/;
/** Deeper block quotes are flattened into the deepest one: real books never nest further, hostile files could. */
export const MAX_QUOTE_DEPTH = 8;
/** Fewer blank lines than one per this many text lines means the file puts one paragraph on each line. */
const LINES_PER_BLANK_LINE = 20;

const isBlank = (line: string) => line.trim() === '';
const startsBlock = (line: string) => ATX.test(line) || FENCE.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line);

/** True when the text (outside fenced code) has almost no blank lines: then each line is a paragraph of its own. */
function hasParagraphPerLine(lines: string[]): boolean {
  let blank = 0;
  let text = 0;
  let fence: string | undefined;
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = undefined;
      continue;
    }
    if (marker) fence = marker;
    else if (isBlank(line)) blank++;
    else text++;
  }
  return text > 1 && blank * LINES_PER_BLANK_LINE < text;
}

/** Removes every leading `>` marker (an iterative loop: the nesting can be arbitrarily deep). */
function stripQuoteMarkers(line: string): string {
  let rest = line;
  for (let m = QUOTE.exec(rest); m; m = QUOTE.exec(rest)) rest = rest.slice(m[0].length);
  return rest;
}

/** Parses Markdown lines into blocks. */
export function parseMarkdownBlocks(lines: string[]): MarkdownBlock[] {
  return parseBlocks(lines, 1, hasParagraphPerLine(lines));
}

/** `depth` is the quote nesting of `lines` plus one; it never exceeds MAX_QUOTE_DEPTH + 1, so the recursion is bounded. */
function parseBlocks(lines: string[], depth: number, perLine: boolean): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const quotes = depth <= MAX_QUOTE_DEPTH;
  const isQuote = (line: string) => quotes && QUOTE.test(line);
  const lineStartsBlock = (line: string) => startsBlock(line) && (quotes || !QUOTE.test(line));
  let i = 0;
  while (i < lines.length) {
    const line = quotes ? (lines[i] as string) : stripQuoteMarkers(lines[i] as string);
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trimStart().startsWith(marker)) body.push(lines[i++] as string);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      // An empty heading carries no title: it is dropped rather than starting an untitled chapter.
      const text = (atx[2] ?? '').trim();
      if (text) blocks.push({ kind: 'heading', level: (atx[1] as string).length, text });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (isQuote(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const current = lines[i] as string;
        if (isBlank(current) || !(QUOTE.test(current) || (!perLine && !startsBlock(current)))) break;
        inner.push(current.replace(QUOTE, ''));
        i++;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(inner, depth + 1, perLine) });
      continue;
    }
    const bullet = BULLET.test(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const marker = bullet ? BULLET : ORDERED;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] as string;
        if (marker.test(current)) {
          items.push(current.replace(marker, ''));
          i++;
        } else if (!perLine && !isBlank(current) && !startsBlock(current) && items.length) {
          // A continuation line (lazy or indented) belongs to the item above.
          items[items.length - 1] += `\n${current.trim()}`;
          i++;
        } else if (isBlank(current) && i + 1 < lines.length && marker.test(lines[i + 1] as string)) {
          i++;
        } else break;
      }
      blocks.push({ kind: 'list', ordered: !bullet, start: ordered ? Number(ordered[1]) : 1, items });
      continue;
    }
    if (perLine) {
      blocks.push({ kind: 'paragraph', text: line.trim() });
      i++;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = quotes ? (lines[i] as string) : stripQuoteMarkers(lines[i] as string);
      if (isBlank(current)) break;
      const setext = paragraph.length > 0 ? SETEXT.exec(current) : null;
      if (setext) {
        blocks.push({ kind: 'heading', level: (setext[1] as string).startsWith('=') ? 1 : 2, text: paragraph.join(' ').trim() });
        paragraph.length = 0;
        i++;
        break;
      }
      if (paragraph.length > 0 && lineStartsBlock(current)) break;
      paragraph.push(current.replace(/^[ \t]+/, ''));
      i++;
    }
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

/**
 * Splits every block whose text is too long for one model answer (see `splitLongText`): a paragraph into several, a
 * list item into several items, a heading into the heading and paragraphs. Code is never translated and stays whole.
 */
export function splitOversizedBlocks(blocks: MarkdownBlock[]): MarkdownBlock[] {
  return blocks.flatMap((block): MarkdownBlock[] => {
    switch (block.kind) {
      case 'paragraph':
        return splitLongText(block.text).map((text) => ({ kind: 'paragraph', text }));
      case 'heading': {
        const [first = '', ...rest] = splitLongText(block.text);
        return [{ ...block, text: first }, ...rest.map((text): MarkdownBlock => ({ kind: 'paragraph', text }))];
      }
      case 'list':
        return [{ ...block, items: block.items.flatMap((item) => splitLongText(item)) }];
      case 'quote':
        return [{ kind: 'quote', blocks: splitOversizedBlocks(block.blocks) }];
      default:
        return [block];
    }
  });
}
