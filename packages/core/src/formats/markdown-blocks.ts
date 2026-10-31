/**
 * Block-level Markdown (the subset books use): ATX and setext headings, paragraphs, block quotes, flat bullet and
 * ordered lists, fenced code, thematic breaks and YAML front matter. Raw HTML blocks and tables are kept as paragraph
 * text (inline rendering drops the tags). Indented text is a paragraph, not code: many plain-text books indent paragraphs.
 */
export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: MarkdownBlock[] }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'rule' };

export interface FrontMatter {
  title?: string;
  author?: string;
  lang?: string;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const BULLET = /^ {0,3}[-*+][ \t]+/;
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+/;

const isBlank = (line: string) => line.trim() === '';
const startsBlock = (line: string) => ATX.test(line) || FENCE.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line);

/** Strips a leading `---` YAML block and reads `title`, `author` and `lang`/`language` from it (simple `key: value` lines). */
export function splitFrontMatter(lines: string[]): { meta: FrontMatter; body: string[] } {
  if (lines[0]?.trim() !== '---') return { meta: {}, body: lines };
  const end = lines.findIndex((l, i) => i > 0 && i <= 60 && /^(?:---|\.\.\.)\s*$/.test(l));
  if (end < 0) return { meta: {}, body: lines };
  const meta: FrontMatter = {};
  for (const line of lines.slice(1, end)) {
    const m = /^(title|author|lang|language)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const value = (m[2] as string).replace(/^(["'])(.*)\1$/, '$2').trim();
    const key = (m[1] as string).toLowerCase();
    if (!value) continue;
    if (key === 'title') meta.title = value;
    else if (key === 'author') meta.author = value;
    else meta.lang = value;
  }
  return { meta, body: lines.slice(end + 1) };
}

/** Parses Markdown lines into blocks. */
export function parseMarkdownBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
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
      blocks.push({ kind: 'heading', level: (atx[1] as string).length, text: (atx[2] ?? '').trim() });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i] as string) && (QUOTE.test(lines[i] as string) || !startsBlock(lines[i] as string))) {
        inner.push((lines[i] as string).replace(QUOTE, ''));
        i++;
      }
      blocks.push({ kind: 'quote', blocks: parseMarkdownBlocks(inner) });
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
        } else if (!isBlank(current) && !startsBlock(current) && items.length) {
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
    const paragraph: string[] = [];
    while (i < lines.length && !isBlank(lines[i] as string)) {
      const current = lines[i] as string;
      const setext = paragraph.length > 0 ? SETEXT.exec(current) : null;
      if (setext) {
        blocks.push({ kind: 'heading', level: (setext[1] as string).startsWith('=') ? 1 : 2, text: paragraph.join(' ').trim() });
        paragraph.length = 0;
        i++;
        break;
      }
      if (paragraph.length > 0 && startsBlock(current)) break;
      paragraph.push(current.replace(/^[ \t]+/, ''));
      i++;
    }
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}
