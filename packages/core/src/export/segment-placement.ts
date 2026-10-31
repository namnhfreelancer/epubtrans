import { fragmentToNodes, parseHtmlFragment } from '../dom/fragment-markup';
import { ELEMENT_NODE, NS, nameOf, textOf } from '../dom/xml-dom-helpers';
import type { DomEnv, ExportMode } from '../types';
import { stripXmlInvalidChars } from '../util/xml-chars';

export const SOURCE_CLASS = 'et-src';
export const TRANSLATION_CLASS = 'et-tr';

/** Blocks that can be duplicated as a sibling without breaking document structure. */
const SIBLING = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', 'address', 'section', 'article', 'aside', 'header', 'footer', 'center']);
/** Phrasing elements: translation goes inline, inside the element. */
const INLINE_CONTEXT = new Set(['a', 'span', 'em', 'i', 'b', 'strong', 'small', 'sub', 'sup', 'u', 's', 'q', 'cite', 'abbr', 'label', 'text']);
const BLOCK_CHILD = new Set(['p', 'div', 'blockquote', 'ul', 'ol', 'dl', 'table', 'section', 'figure', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr']);

export interface PlacementContext {
  env: DomEnv;
  mode: ExportMode;
  targetLang: string;
  /** EPUB 2 (XHTML 1.1) forbids the `lang` attribute; only `xml:lang` is written. */
  xmlLangOnly: boolean;
  /** Navigation documents keep one label per entry: translations are merged inline. */
  inline: boolean;
}

export function setLang(el: Element, ctx: PlacementContext): void {
  el.setAttributeNS(NS.XML, 'xml:lang', ctx.targetLang);
  if (!ctx.xmlLangOnly) el.setAttribute('lang', ctx.targetLang);
}

export function addClass(el: Element, cls: string): void {
  const current = el.getAttribute('class');
  el.setAttribute('class', current ? `${current} ${cls}` : cls);
}

/**
 * Inserts the translation of segment block `el` according to the export mode. Characters XML 1.0 forbids (model output
 * or a crafted project file may hold them, raw or as character references) are dropped before and after parsing, so the
 * exported document stays well-formed.
 */
export function placeTranslation(el: Element, translationHtml: string, ctx: PlacementContext): void {
  const doc = el.ownerDocument;
  const nodes = fragmentToNodes(ctx.env, stripXmlInvalidChars(translationHtml), doc);
  const name = nameOf(el);
  // The source copy keeps the ids (link targets); duplicated ids would make the document invalid.
  if (ctx.mode !== 'translation-only') for (const n of nodes) stripIds(n);

  if (ctx.mode === 'translation-only') {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const n of nodes) el.appendChild(n);
    setLang(el, ctx);
    return;
  }

  if (!ctx.inline && SIBLING.has(name)) {
    const clone = el.cloneNode(false) as Element;
    for (const attr of ['id', 'lang', 'xml:lang']) clone.removeAttribute(attr);
    addClass(clone, TRANSLATION_CLASS);
    setLang(clone, ctx);
    for (const n of nodes) clone.appendChild(n);
    addClass(el, SOURCE_CLASS);
    el.parentNode?.insertBefore(clone, ctx.mode === 'bilingual' ? el.nextSibling : el);
    return;
  }

  // Wrap source and translation inside the element (list items, cells, TOC labels...).
  const hasBlocks = Array.from(el.childNodes).some((n) => BLOCK_CHILD.has(nameOf(n))) || nodes.some((n) => BLOCK_CHILD.has(nameOf(n)));
  const wrapperTag = hasBlocks && !ctx.inline && !INLINE_CONTEXT.has(name) ? 'div' : 'span';
  const source = doc.createElementNS(NS.XHTML, wrapperTag);
  source.setAttribute('class', SOURCE_CLASS);
  while (el.firstChild) source.appendChild(el.firstChild);
  const translation = doc.createElementNS(NS.XHTML, wrapperTag);
  translation.setAttribute('class', TRANSLATION_CLASS);
  setLang(translation, ctx);
  for (const n of nodes) translation.appendChild(n);
  const separator = wrapperTag === 'span' ? (ctx.inline ? doc.createTextNode(' / ') : doc.createElementNS(NS.XHTML, 'br')) : null;
  const ordered = ctx.mode === 'bilingual' ? [source, separator, translation] : [translation, separator, source];
  for (const n of ordered) if (n) el.appendChild(n);
}

function stripIds(node: Node): void {
  if (node.nodeType !== ELEMENT_NODE) return;
  const el = node as Element;
  el.removeAttribute('id');
  for (const d of Array.from(el.querySelectorAll('[id]'))) d.removeAttribute('id');
}

/** Plain-text label for contexts that cannot hold markup (NCX). */
export function textLabel(sourceText: string, translationHtml: string, ctx: Pick<PlacementContext, 'env' | 'mode'>): string {
  if (ctx.mode === 'original') return sourceText;
  // Stripped after parsing too: the parser decodes references such as `&#xFFFE;` into raw characters.
  const translated = stripXmlInvalidChars(textOf(parseHtmlFragment(ctx.env, translationHtml)));
  if (ctx.mode === 'translation-only') return translated;
  return ctx.mode === 'bilingual' ? `${sourceText} / ${translated}` : `${translated} / ${sourceText}`;
}
