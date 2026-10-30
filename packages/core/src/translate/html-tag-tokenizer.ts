/**
 * Tag tokenizer that follows the WHATWG HTML tokenizer states for start and end tags
 * (tag open, tag name, before/after attribute name, attribute value, self-closing start tag).
 * Every tag an HTML parser would create is reported, including forms that a simple regex
 * misses, such as `<img/src=x onerror=…>` or `<svg/onload=…>`.
 *
 * Callers must reject comments, doctypes, processing instructions and raw-text elements
 * (`<!`, `<?`, `</` + non-letter, `<script>`, `<textarea>`…) before trusting the result: inside
 * those, an HTML parser does not create tags, so this tokenizer and the parser could disagree.
 */

export interface HtmlTag {
  /** Lower-cased tag name. */
  name: string;
  end: boolean;
  selfClosing: boolean;
  /** Lower-cased attribute names with decoded values, in source order (duplicates kept). */
  attrs: [string, string][];
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);

/** Decodes the predefined entities and numeric references (enough for exact comparison against our serializer). */
export function decodeAttributeValue(value: string): string {
  return value.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(quot|apos|lt|gt|amp|#39));/g, (all, dec: string, hex: string, named: string) => {
    if (dec || hex) {
      const code = Number.parseInt(dec ?? hex, dec ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return { quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', amp: '&' }[named] ?? all;
  });
}

/**
 * Returns every start/end tag in `html`, or undefined when the input ends inside a tag
 * (an HTML parser silently drops such a tag, so the markup is not what it appears to be).
 */
export function tokenizeTags(html: string): HtmlTag[] | undefined {
  const tags: HtmlTag[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    let j = lt + 1;
    const end = html[j] === '/';
    if (end) j++;
    if (!isLetter(html[j])) {
      i = lt + 1;
      continue;
    }
    const tag = readTag(html, j, end);
    if (!tag) return undefined;
    tags.push(tag.tag);
    i = tag.next;
  }
  return tags;
}

/** Reads a tag whose name starts at `start`; returns the tag and the index after its `>`. */
function readTag(html: string, start: number, end: boolean): { tag: HtmlTag; next: number } | undefined {
  let i = start;
  while (i < html.length && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>') i++;
  const tag: HtmlTag = { name: html.slice(start, i).toLowerCase(), end, selfClosing: false, attrs: [] };
  while (i < html.length) {
    const c = html[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '>') return { tag, next: i + 1 };
    if (c === '/') {
      if (html[i + 1] === '>') {
        tag.selfClosing = true;
        return { tag, next: i + 2 };
      }
      i++;
      continue;
    }
    // Attribute name: the first character may be '=', then anything up to space, '/', '>' or '='.
    const nameStart = i;
    i++;
    while (i < html.length && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    const name = html.slice(nameStart, i).toLowerCase();
    while (isSpace(html[i])) i++;
    if (html[i] !== '=') {
      tag.attrs.push([name, '']);
      continue;
    }
    i++;
    while (isSpace(html[i])) i++;
    const quote = html[i];
    let value: string;
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, i + 1);
      if (close < 0) return undefined;
      value = html.slice(i + 1, close);
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < html.length && !isSpace(html[i]) && html[i] !== '>') i++;
      value = html.slice(valueStart, i);
    }
    tag.attrs.push([name, decodeAttributeValue(value)]);
  }
  return undefined;
}
