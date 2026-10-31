import { isActiveAttribute } from './active-attributes';

/**
 * Text-level reading of an XML prolog. Done on the markup string because some DOMs (linkedom)
 * drop the prolog's processing instructions while parsing.
 */

export interface PrologScan {
  /** Data (text after the target) of each `xml-stylesheet` processing instruction in the prolog. */
  stylesheets: string[];
  /** Lower-cased local name of the document element, when the prolog could be read up to it. */
  root?: string;
}

const XML_SPACE = /[ \t\r\n]/;
const PI_TARGET = /^([^ \t\r\n?]+)([\s\S]*)$/;
const ROOT_NAME = /^<([A-Za-z_][\w.:-]*)/;

/**
 * Reads the prolog (XML declaration, processing instructions, comments, doctype) up to the
 * document element. Stops without a root when the prolog is unterminated or the doctype has an
 * internal subset, whose declarations could hide anything: instructions after that point are
 * not reported, so callers drop them.
 */
export function scanProlog(markup: string): PrologScan {
  const stylesheets: string[] = [];
  let i = markup.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < markup.length) {
    while (i < markup.length && XML_SPACE.test(markup.charAt(i))) i++;
    if (markup.startsWith('<?', i)) {
      const end = markup.indexOf('?>', i + 2);
      if (end < 0) break;
      const [, target, data = ''] = PI_TARGET.exec(markup.slice(i + 2, end)) ?? [];
      if (target === 'xml-stylesheet') stylesheets.push(data);
      i = end + 2;
    } else if (markup.startsWith('<!--', i)) {
      const end = markup.indexOf('-->', i + 4);
      if (end < 0) break;
      i = end + 3;
    } else if (markup.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      const end = doctypeEnd(markup, i + 9);
      if (end < 0) break;
      i = end;
    } else {
      const name = ROOT_NAME.exec(markup.slice(i, i + 256))?.[1];
      return name ? { stylesheets, root: name.slice(name.indexOf(':') + 1).toLowerCase() } : { stylesheets };
    }
  }
  return { stylesheets };
}

/** Index just past the doctype's closing `>` (quotes respected), or -1 for an internal subset or no end. */
function doctypeEnd(markup: string, from: number): number {
  let quote = '';
  for (let i = from; i < markup.length; i++) {
    const c = markup.charAt(i);
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') return -1;
    else if (c === '>') return i + 1;
  }
  return -1;
}

/** True when the markup contains an `xml-stylesheet` processing instruction anywhere (any case). */
export const hasStylesheetInstruction = (markup: string): boolean => /<\?xml-stylesheet/i.test(markup);

/** Pseudo-attributes the xml-stylesheet recommendation defines. */
const PSEUDO_ATTR_NAMES = new Set(['href', 'type', 'title', 'media', 'charset', 'alternate']);

/**
 * Parses the data of an `xml-stylesheet` instruction as the recommendation's pseudo-attributes and
 * returns the instruction rebuilt from them when it is plain CSS (`type` exactly `text/css`, a
 * non-script `href`). Anything ambiguous yields undefined: unknown or repeated pseudo-attributes,
 * references (`&`), `<`, missing whitespace, or trailing text. Browsers apply stylesheets of
 * other types as XSLT, whose output may contain scripts.
 */
export function cssStylesheetInstruction(data: string): string | undefined {
  const pseudoAttr = /[ \t\r\n]+([A-Za-z_][\w.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<&]*)"|'([^'<&]*)')/y;
  const attrs = new Map<string, string>();
  let pos = 0;
  for (let m = pseudoAttr.exec(data); m; m = pseudoAttr.exec(data)) {
    const name = m[1] ?? '';
    if (!PSEUDO_ATTR_NAMES.has(name) || attrs.has(name)) return undefined;
    attrs.set(name, m[2] ?? m[3] ?? '');
    pos = pseudoAttr.lastIndex;
  }
  if (!/^[ \t\r\n]*$/.test(data.slice(pos))) return undefined;
  const href = attrs.get('href');
  if (attrs.get('type') !== 'text/css' || !href || isActiveAttribute('href', href)) return undefined;
  const written = Array.from(attrs, ([name, value]) => `${name}="${value.replace(/"/g, '&quot;')}"`);
  return `<?xml-stylesheet ${written.join(' ')}?>`;
}

/** The prolog's CSS `xml-stylesheet` instructions, validated and rebuilt; every other instruction is dropped. */
export function cssStylesheetInstructions(markup: string): string[] {
  return scanProlog(markup)
    .stylesheets.map(cssStylesheetInstruction)
    .filter((pi): pi is string => pi !== undefined);
}
