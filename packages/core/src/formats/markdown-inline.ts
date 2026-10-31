import { NS } from '../dom/xml-dom-helpers';

/**
 * Inline Markdown to DOM nodes: emphasis and strong (`*`, `_`), strikethrough (`~~`), code spans, links, autolinks,
 * images (as their alt text, a converted text book has no image files), backslash escapes and hard line breaks.
 * Raw HTML is never passed through: tags are dropped (their text stays), `<br>` becomes a line break. Link targets are
 * kept only for http(s) and mailto URLs; other links keep their text without a target.
 */

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>"'&]/;
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/i;
const HTML_TAG = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/;
const HTML_COMMENT = /^<!--[\s\S]*?-->/;
const DROPPED_CONTENT = new Set(['script', 'style', 'template', 'iframe', 'object', 'noscript', 'textarea']);

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

/** Index of the `]` closing the `[` at `open`, honouring nesting and escapes; -1 when unbalanced. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Parses `(url "title")` at `start`; returns the url and the index after `)`. */
function linkDestination(text: string, start: number): { url: string; end: number } | undefined {
  if (text[start] !== '(') return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      const inner = text.slice(start + 1, i).trim();
      const url = /^(<[^>]*>|\S+)/.exec(inner)?.[1] ?? '';
      return { url, end: i + 1 };
    }
  }
  return undefined;
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/u.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Index of a closing delimiter run equal to `run` after `from` (right-flanking, not intraword for `_`); -1 when none. */
function closingRun(text: string, from: number, run: string): number {
  for (let i = from; i <= text.length - run.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > 0) i = end;
      continue;
    }
    if (!text.startsWith(run, i)) continue;
    const ch = run[0];
    // The run must be exactly this long and close a non-empty span.
    if (text[i + run.length] === ch || text[i - 1] === ch || i === from || isSpace(text[i - 1])) continue;
    if (ch === '_' && isWordChar(text[i + run.length])) continue;
    return i;
  }
  return -1;
}

/** Renders inline Markdown into nodes owned by `doc`. */
export function renderInline(doc: Document, text: string): Node[] {
  const out: Node[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push(doc.createTextNode(buffer));
    buffer = '';
  };
  const element = (tag: string, children: Node[]) => {
    const el = doc.createElementNS(NS.XHTML, tag);
    for (const c of children) el.appendChild(c);
    return el;
  };

  for (let i = 0; i < text.length; ) {
    const ch = text[i] as string;
    const rest = text.slice(i);
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1] as string;
      if (next === '\n') {
        flush();
        out.push(doc.createElementNS(NS.XHTML, 'br'));
        i += 2;
        continue;
      }
      if (ESCAPABLE.test(next)) {
        buffer += next;
        i += 2;
        continue;
      }
    }
    if (ch === '\n') {
      // Two trailing spaces before a newline are a hard break; otherwise the newline is a space.
      if (buffer.endsWith('  ')) {
        buffer = buffer.replace(/ +$/, '');
        flush();
        out.push(doc.createElementNS(NS.XHTML, 'br'));
      } else buffer = `${buffer.replace(/ +$/, '')} `;
      i++;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(rest)?.[0] ?? '`';
      const end = text.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        const code = doc.createElementNS(NS.XHTML, 'code');
        code.textContent = text
          .slice(i + run.length, end)
          .replace(/\n/g, ' ')
          .trim();
        out.push(code);
        i = end + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }
    if (ch === '!' && text[i + 1] === '[') {
      const close = closingBracket(text, i + 1);
      const dest = close > 0 ? linkDestination(text, close + 1) : undefined;
      if (dest) {
        flush();
        out.push(...renderInline(doc, text.slice(i + 2, close)));
        i = dest.end;
        continue;
      }
    }
    if (ch === '[') {
      const close = closingBracket(text, i);
      const dest = close > 0 ? linkDestination(text, close + 1) : undefined;
      if (dest) {
        flush();
        const label = renderInline(doc, text.slice(i + 1, close));
        const href = safeHref(dest.url);
        if (href) {
          const a = element('a', label);
          a.setAttribute('href', href);
          out.push(a);
        } else out.push(...label);
        i = dest.end;
        continue;
      }
    }
    if (ch === '<') {
      const auto = AUTOLINK.exec(rest);
      const href = auto ? safeHref(auto[1] as string) : undefined;
      if (auto && href) {
        flush();
        const a = doc.createElementNS(NS.XHTML, 'a');
        a.setAttribute('href', href);
        a.textContent = auto[1] as string;
        out.push(a);
        i += auto[0].length;
        continue;
      }
      const comment = HTML_COMMENT.exec(rest);
      const tag = comment ? undefined : HTML_TAG.exec(rest);
      if (comment || tag) {
        const name = tag?.[1]?.toLowerCase() ?? '';
        if (name === 'br') {
          flush();
          out.push(doc.createElementNS(NS.XHTML, 'br'));
        }
        i += (comment ?? tag)?.[0].length ?? 1;
        // Script-like elements lose their content too: it was never meant to be read.
        if (tag && !tag[0].startsWith('</') && DROPPED_CONTENT.has(name)) {
          const close = text.toLowerCase().indexOf(`</${name}`, i);
          const end = close < 0 ? -1 : text.indexOf('>', close);
          i = end < 0 ? text.length : end + 1;
        }
        continue;
      }
    }
    if (ch === '~' && text.startsWith('~~', i) && !isSpace(text[i + 2])) {
      const end = closingRun(text, i + 2, '~~');
      if (end > 0) {
        flush();
        out.push(element('s', renderInline(doc, text.slice(i + 2, end))));
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const run = (/^(\*+|_+)/.exec(rest)?.[0] ?? ch).slice(0, 3);
      const opens = !isSpace(text[i + run.length]) && !(ch === '_' && isWordChar(text[i - 1]));
      const end = opens ? closingRun(text, i + run.length, run) : -1;
      if (end > 0) {
        flush();
        const inner = renderInline(doc, text.slice(i + run.length, end));
        out.push(run.length === 1 ? element('em', inner) : run.length === 2 ? element('strong', inner) : element('strong', [element('em', inner)]));
        i = end + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}
