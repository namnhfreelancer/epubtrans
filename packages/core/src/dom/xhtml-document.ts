import type { DomEnv } from '../types';
import { escapeXml } from '../util/text-encoding';
import { convertHtmlNodes } from './html-to-xhtml';
import { byLocalName, firstByLocalName, isParserError, NS, nameOf, textOf } from './xml-dom-helpers';

const XML_ENTITIES = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[A-Za-z][A-Za-z0-9]*;/;

/** Creates an empty XHTML 5 document (XML DOM) with the given title and language. */
export function createXhtmlDocument(env: DomEnv, title: string, lang?: string): Document {
  const langAttrs = lang ? ` lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}"` : '';
  const markup = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="${NS.EPUB}"${langAttrs}><head><title>${escapeXml(title)}</title></head><body></body></html>`;
  return new env.DOMParser().parseFromString(markup, 'application/xhtml+xml');
}

export function bodyOf(doc: Document): Element {
  const body = firstByLocalName(doc, 'body');
  if (!body) throw new Error('Document has no <body>');
  return body;
}

export function headOf(doc: Document): Element {
  const head = firstByLocalName(doc, 'head');
  if (!head) throw new Error('Document has no <head>');
  return head;
}

/**
 * Parses a content document into an XML DOM. Well-formed XHTML is kept as is; markup that
 * is not well-formed XML (or uses HTML named entities) is parsed as HTML and rebuilt as XHTML.
 */
export function parseXhtmlDocument(env: DomEnv, markup: string, opts: { strict?: boolean } = {}): Document {
  if (!opts.strict && !XML_ENTITIES.test(markup)) {
    const doc = new env.DOMParser().parseFromString(markup, 'application/xhtml+xml');
    if (!isParserError(doc) && nameOf(doc.documentElement) === 'html' && firstByLocalName(doc, 'body')) return doc;
  }
  return htmlToXhtmlDocument(env, markup, opts.strict ?? false);
}

/**
 * Parses HTML (possibly a fragment such as a MOBI section) as a full document. Markup without a
 * <body> is wrapped, because not every DOM implementation builds html/body for fragments.
 */
export function parseHtmlDocument(env: DomEnv, markup: string): Document {
  const full = /<body[\s>]/i.test(markup) ? markup : `<!DOCTYPE html><html><head></head><body>${markup.replace(/<\/?(?:html|body)\s*>/gi, '')}</body></html>`;
  return new env.DOMParser().parseFromString(full, 'text/html');
}

function htmlToXhtmlDocument(env: DomEnv, markup: string, strict: boolean): Document {
  const html = parseHtmlDocument(env, markup);
  const root = html.documentElement;
  const lang = root?.getAttribute('lang') ?? root?.getAttribute('xml:lang') ?? undefined;
  const title = textOf(firstByLocalName(html, 'title'));
  const doc = createXhtmlDocument(env, title, lang);
  const usedIds = new Set<string>();
  if (!strict) {
    const headSrc = firstByLocalName(html, 'head');
    const keep = headSrc ? Array.from(headSrc.childNodes).filter((n) => ['link', 'style'].includes(nameOf(n))) : [];
    for (const n of convertHtmlNodes(keep, doc, { strict: false })) headOf(doc).appendChild(n);
  }
  const bodySrc = firstByLocalName(html, 'body');
  const body = bodyOf(doc);
  if (bodySrc) {
    for (const attr of ['class', 'id', 'dir']) {
      const v = bodySrc.getAttribute(attr);
      if (v) body.setAttribute(attr, v);
    }
    for (const n of convertHtmlNodes(Array.from(bodySrc.childNodes), doc, { strict, usedIds })) body.appendChild(n);
  }
  return doc;
}

/** Prolog lines between the XML declaration and the doctype or document element. */
const prologLines = (instructions: readonly string[]) => instructions.map((pi) => `${pi}\n`).join('');

/**
 * Serializes an XHTML document with an XML declaration and a doctype (HTML5 unless given, none when null).
 * `instructions` are prolog processing instructions written verbatim after the declaration;
 * callers pass only instructions they have validated.
 */
export function serializeXhtmlDocument(env: DomEnv, doc: Document, doctype: string | null = '<!DOCTYPE html>', instructions: readonly string[] = []): string {
  const markup = new env.XMLSerializer().serializeToString(doc.documentElement);
  return `<?xml version="1.0" encoding="utf-8"?>\n${prologLines(instructions)}${doctype === null ? '' : `${doctype}\n`}${markup}\n`;
}

/** The document type declaration of a markup string (without internal subset), if any. */
export function extractDoctype(markup: string): string | undefined {
  const m = /<!DOCTYPE\s+html[^>[]*>/i.exec(markup.slice(0, 2048));
  return m?.[0];
}

/**
 * Doctype for an exported content document: the one in `markup`, or HTML5. EPUB 2 content documents are XHTML 1.1,
 * where epubcheck rejects the HTML5 doctype (which import writes when the source had none), so there a bare
 * `<!DOCTYPE html>` becomes no doctype at all (null).
 */
export function exportDoctype(markup: string, epub2: boolean): string | null {
  const doctype = extractDoctype(markup);
  if (!epub2) return doctype ?? '<!DOCTYPE html>';
  return doctype && !/^<!DOCTYPE\s+html\s*>$/i.test(doctype) ? doctype : null;
}

/** Serializes a generic XML document (OPF, NCX, container) with an XML declaration and optional validated prolog instructions. */
export function serializeXmlDocument(env: DomEnv, doc: Document, instructions: readonly string[] = []): string {
  const markup = new env.XMLSerializer().serializeToString(doc.documentElement);
  return `<?xml version="1.0" encoding="utf-8"?>\n${prologLines(instructions)}${markup}\n`;
}

/** Adds a stylesheet link to the head unless one with the same href exists. */
export function ensureStylesheet(doc: Document, href: string): void {
  const head = headOf(doc);
  if (byLocalName(head, 'link').some((l) => l.getAttribute('href') === href)) return;
  const link = doc.createElementNS(NS.XHTML, 'link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('type', 'text/css');
  link.setAttribute('href', href);
  head.appendChild(link);
}
