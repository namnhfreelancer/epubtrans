import { NS } from '../dom/xml-dom-helpers';

/**
 * Inline Markdown to DOM nodes: emphasis and strong (`*`, `_`), strikethrough (`~~`), code spans, links, autolinks,
 * images (as their alt text, a converted text book has no image files), backslash escapes and hard line breaks.
 * Raw HTML is never passed through: tags are dropped (their text stays), `<br>` becomes a line break. Link targets are
 * kept only for http(s) and mailto URLs; other links keep their text without a target.
 *
 * Parsing is one left-to-right pass with a delimiter stack, as in CommonMark: an opener is remembered, a closer wraps
 * everything since the nearest matching opener, and an opener that is never closed stays literal text. Every search
 * is bounded or memoized, so the work is linear in the text length and nothing recurses (hostile input cannot freeze
 * an import or overflow the stack).
 */

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>"'&]/;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/iy;
const HTML_TAG = /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/y;
const DROPPED_CONTENT = new Set(['script', 'style', 'template', 'iframe', 'object', 'noscript', 'textarea']);
/** A link destination longer than this, or nested deeper than CommonMark's limit, is not a destination. */
const MAX_DESTINATION_CHARS = 2048;
const MAX_DESTINATION_PARENS = 32;
/** Characters that may start markup; text between them is copied in one slice. */
const MARKUP_START = new Uint8Array(128);
for (const ch of '\\\n`![]<*_~') MARKUP_START[ch.charCodeAt(0)] = 1;
/** The end of the run of text without markup characters that starts after `start`. */
function plainRunEnd(text: string, start: number): number {
  let end = start + 1;
  for (; end < text.length; end++) {
    const code = text.charCodeAt(end);
    if (code < 128 && MARKUP_START[code]) break;
  }
  return end;
}

/** An href that is safe and meaningful in an exported book, or undefined. */
export function safeHref(raw: string): string | undefined {
  const href = raw.trim().replace(/^<|>$/g, '');
  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(href)) return `mailto:${href}`;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Parses `(url "title")` at `start`; returns the url and the index after `)`. */
function linkDestination(text: string, start: number): { url: string; end: number } | undefined {
  if (text[start] !== '(') return undefined;
  const limit = Math.min(text.length, start + MAX_DESTINATION_CHARS);
  let depth = 0;
  for (let i = start; i < limit; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '(') {
      if (++depth > MAX_DESTINATION_PARENS) return undefined;
    } else if (ch === ')' && --depth === 0) {
      const inner = text.slice(start + 1, i).trim();
      const url = /^(<[^>]*>|\S+)/.exec(inner)?.[1] ?? '';
      return { url, end: i + 1 };
    }
  }
  return undefined;
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/u.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const runLength = (text: string, at: number) => {
  let end = at;
  while (text[end] === text[at]) end++;
  return end - at;
};

/** Pending inline content: literal text (including delimiters not matched yet) or finished nodes. */
type Entry = string | Node;

/** Renders inline Markdown into nodes owned by `doc`. */
export function renderInline(doc: Document, text: string): Node[] {
  const entries: Entry[] = [];
  // Literal text since the last entry. The spaces at its end are only counted, and written once more text follows: a
  // newline drops them, and cutting them off a long string at every soft line break would make a long hard-wrapped
  // paragraph quadratic.
  let buffer = '';
  let trailingSpaces = 0;
  // Unclosed emphasis delimiters by run (`*`, `**`, `***`, `_`, `__`, `___`, `~~`): indexes of their text in `entries`.
  const openers = new Map<string, number[]>();
  // Unclosed `[` and `![`, innermost last.
  const brackets: { at: number; image: boolean }[] = [];
  // Links do not nest: a `[` before this index (an outer label of a finished link) no longer opens a link.
  let linkFloor = 0;
  // Searches that already failed once fail for every later start too, so they are not repeated.
  const missingCodeCloser = new Set<number>();
  let missingCommentEnd = false;
  let lowerText: string | undefined;

  const writeSpaces = () => {
    if (trailingSpaces) buffer += trailingSpaces === 1 ? ' ' : ' '.repeat(trailingSpaces);
    trailingSpaces = 0;
  };
  /** Appends text that does not end with a space (markup characters left literal). */
  const append = (piece: string) => {
    writeSpaces();
    buffer += piece;
  };
  /** Appends `text` from `start` to `end`, keeping the spaces at its end aside. */
  const appendPlain = (start: number, end: number) => {
    let last = end;
    while (last > start && text.charCodeAt(last - 1) === 32) last--;
    if (last > start) append(last === start + 1 ? (text[start] as string) : text.slice(start, last));
    trailingSpaces += end - last;
  };
  const flush = () => {
    writeSpaces();
    if (buffer) entries.push(buffer);
    buffer = '';
  };
  const toNodes = (items: Entry[]): Node[] => {
    const nodes: Node[] = [];
    let run = '';
    for (const item of items) {
      if (typeof item === 'string') run += item;
      else {
        if (run) nodes.push(doc.createTextNode(run));
        run = '';
        nodes.push(item);
      }
    }
    if (run) nodes.push(doc.createTextNode(run));
    return nodes;
  };
  const element = (tag: string, children: Node[]) => {
    const el = doc.createElementNS(NS.XHTML, tag);
    for (const c of children) el.appendChild(c);
    return el;
  };
  const pushNode = (node: Node) => {
    flush();
    entries.push(node);
  };
  /** Removes the opener at `at` and everything after it; returns the content after the opener as nodes. */
  const takeFrom = (at: number): Node[] => {
    flush();
    const tail = entries.splice(at);
    for (const stack of openers.values()) while ((stack.at(-1) ?? -1) >= at) stack.pop();
    while ((brackets.at(-1)?.at ?? -1) >= at) brackets.pop();
    linkFloor = Math.min(linkFloor, at);
    return toNodes(tail.slice(1));
  };
  const open = (run: string) => {
    flush();
    const stack = openers.get(run) ?? [];
    stack.push(entries.length);
    openers.set(run, stack);
    entries.push(run);
  };
  const wrapEmphasis = (run: string, children: Node[]) => {
    if (run === '~~') return element('s', children);
    if (run.length === 1) return element('em', children);
    if (run.length === 2) return element('strong', children);
    return element('strong', [element('em', children)]);
  };

  for (let i = 0; i < text.length; ) {
    const ch = text[i] as string;
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1] as string;
      if (next === '\n') {
        pushNode(doc.createElementNS(NS.XHTML, 'br'));
        i += 2;
        continue;
      }
      if (ESCAPABLE.test(next)) {
        append(next);
        i += 2;
        continue;
      }
    }
    if (ch === '\n') {
      // Two trailing spaces before a newline are a hard break; otherwise the newline is a space.
      if (trailingSpaces >= 2) {
        trailingSpaces = 0;
        pushNode(doc.createElementNS(NS.XHTML, 'br'));
      } else trailingSpaces = 1;
      i++;
      continue;
    }
    if (ch === '`') {
      const length = runLength(text, i);
      const run = text.slice(i, i + length);
      const end = missingCodeCloser.has(length) ? -1 : text.indexOf(run, i + length);
      if (end < 0) {
        missingCodeCloser.add(length);
        append(run);
        i += length;
        continue;
      }
      const code = doc.createElementNS(NS.XHTML, 'code');
      code.textContent = text
        .slice(i + length, end)
        .replace(/\n/g, ' ')
        .trim();
      pushNode(code);
      i = end + length;
      continue;
    }
    if (ch === '!' && text[i + 1] === '[') {
      flush();
      brackets.push({ at: entries.length, image: true });
      entries.push('![');
      i += 2;
      continue;
    }
    if (ch === '[') {
      flush();
      brackets.push({ at: entries.length, image: false });
      entries.push('[');
      i++;
      continue;
    }
    if (ch === ']') {
      const opener = brackets.at(-1);
      const dest = opener && (opener.image || opener.at >= linkFloor) ? linkDestination(text, i + 1) : undefined;
      if (!opener || !dest) {
        // An unmatched `]` is text, and so is the `[` it fails to close.
        if (opener) brackets.pop();
        append(']');
        i++;
        continue;
      }
      const label = takeFrom(opener.at);
      if (opener.image) for (const node of label) pushNode(node);
      else {
        const href = safeHref(dest.url);
        if (href) {
          const a = element('a', label);
          a.setAttribute('href', href);
          pushNode(a);
        } else for (const node of label) pushNode(node);
        linkFloor = opener.at;
      }
      i = dest.end;
      continue;
    }
    if (ch === '<') {
      AUTOLINK.lastIndex = i;
      const auto = AUTOLINK.exec(text);
      const href = auto ? safeHref(auto[1] as string) : undefined;
      if (auto && href) {
        const a = doc.createElementNS(NS.XHTML, 'a');
        a.setAttribute('href', href);
        a.textContent = auto[1] as string;
        pushNode(a);
        i += auto[0].length;
        continue;
      }
      if (text.startsWith('<!--', i)) {
        const end = missingCommentEnd ? -1 : text.indexOf('-->', i + 4);
        if (end >= 0) {
          i = end + 3;
          continue;
        }
        missingCommentEnd = true;
      }
      HTML_TAG.lastIndex = i;
      const tag = HTML_TAG.exec(text);
      if (tag) {
        const name = (tag[1] as string).toLowerCase();
        if (name === 'br') pushNode(doc.createElementNS(NS.XHTML, 'br'));
        i += tag[0].length;
        // Script-like elements lose their content too: it was never meant to be read.
        if (!tag[0].startsWith('</') && DROPPED_CONTENT.has(name)) {
          lowerText ??= text.toLowerCase();
          const close = lowerText.indexOf(`</${name}`, i);
          const end = close < 0 ? -1 : text.indexOf('>', close);
          i = end < 0 ? text.length : end + 1;
        }
        continue;
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const length = runLength(text, i);
      const run = text.slice(i, i + length);
      const valid = ch === '~' ? length === 2 : length <= 3;
      if (!valid) {
        append(run);
        i += length;
        continue;
      }
      const before = text[i - 1];
      const after = text[i + length];
      const canOpen = !isSpace(after) && !(ch === '_' && isWordChar(before));
      const canClose = !isSpace(before) && !(ch === '_' && isWordChar(after));
      const opener = openers.get(run)?.at(-1);
      // A closer never reaches across an unclosed bracket: link labels bind tighter than emphasis.
      const closes =
        canClose && opener !== undefined && opener > (brackets.at(-1)?.at ?? -1) && (buffer !== '' || trailingSpaces > 0 || entries.length > opener + 1);
      if (closes) pushNode(wrapEmphasis(run, takeFrom(opener)));
      else if (canOpen) open(run);
      else append(run);
      i += length;
      continue;
    }
    const end = plainRunEnd(text, i);
    appendPlain(i, end);
    i = end;
  }
  flush();
  return toNodes(entries);
}
