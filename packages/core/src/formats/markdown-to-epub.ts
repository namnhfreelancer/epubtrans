import { createXhtmlDocument } from '../dom/xhtml-document';
import { NS, textOf } from '../dom/xml-dom-helpers';
import { detectTextLanguage } from '../lang/detect-language';
import type { DomEnv } from '../types';
import { type MarkdownBlock, parseMarkdownBlocks } from './markdown-blocks';
import { splitFrontMatter } from './markdown-front-matter';
import { renderInline } from './markdown-inline';
import { createInlineSplitter, type InlineContent } from './markdown-inline-split';
import { type BlockRenderer, buildTextBook, chunkChapters, decodeTextFile, type TextChapter, titleFromFileName } from './text-book';

/** Fills `node` with inline content: Markdown rendered in its document, or nodes rendered elsewhere imported into it. */
function fillInline(node: Element, content: InlineContent): void {
  const doc = node.ownerDocument as Document;
  if (typeof content === 'string') for (const n of renderInline(doc, content)) node.appendChild(n);
  else for (const n of content) node.appendChild(doc.importNode(n, true));
}

const inlineElement =
  (tag: string, content: InlineContent): BlockRenderer =>
  (doc) => {
    const node = doc.createElementNS(NS.XHTML, tag);
    fillInline(node, content);
    return node;
  };

/**
 * The block elements of a Markdown block. Text too long for one segment is split (see `createInlineSplitter`): a
 * paragraph into several paragraphs, a heading into the heading and paragraphs, a list item into several items. Code is
 * never translated and stays whole; a quote stays one block around its (split) inner blocks.
 */
function renderBlock(block: MarkdownBlock, split: (text: string) => InlineContent[]): BlockRenderer[] {
  switch (block.kind) {
    case 'heading': {
      const [first = '', ...rest] = split(block.text);
      return [inlineElement(`h${block.level}`, first), ...rest.map((part) => inlineElement('p', part))];
    }
    case 'paragraph':
      return split(block.text).map((part) => inlineElement('p', part));
    case 'rule':
      return [(doc) => doc.createElementNS(NS.XHTML, 'hr')];
    case 'code':
      return [
        (doc) => {
          const pre = doc.createElementNS(NS.XHTML, 'pre');
          const code = doc.createElementNS(NS.XHTML, 'code');
          code.textContent = block.text;
          pre.appendChild(code);
          return pre;
        },
      ];
    case 'quote': {
      const inner = block.blocks.flatMap((b) => renderBlock(b, split));
      return [
        (doc) => {
          const quote = doc.createElementNS(NS.XHTML, 'blockquote');
          for (const render of inner) quote.appendChild(render(doc));
          // An empty quote would be an empty block element; give it a paragraph so the document stays meaningful.
          if (!quote.firstChild) quote.appendChild(doc.createElementNS(NS.XHTML, 'p'));
          return quote;
        },
      ];
    }
    case 'list': {
      const items = block.items.flatMap((item) => split(item));
      return [
        (doc) => {
          const list = doc.createElementNS(NS.XHTML, block.ordered ? 'ol' : 'ul');
          if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
          for (const item of items) list.appendChild(inlineElement('li', item)(doc));
          return list;
        },
      ];
    }
  }
}

/** Plain text of a heading's inline Markdown (for the table of contents and the book title). */
function plainHeading(env: DomEnv, text: string): string {
  const doc = createXhtmlDocument(env, '');
  const span = doc.createElementNS(NS.XHTML, 'span');
  for (const n of renderInline(doc, text)) span.appendChild(n);
  return textOf(span);
}

/** A front-matter language as a canonical BCP 47 tag; anything else is ignored (it would end up in `xml:lang`). */
function canonicalLanguage(tag: string | undefined): string | undefined {
  if (!tag?.trim()) return undefined;
  try {
    return Intl.getCanonicalLocales(tag.trim())[0];
  } catch {
    return undefined;
  }
}

/** Plain text of every block, for language detection. */
function blockTexts(blocks: MarkdownBlock[]): string[] {
  return blocks.flatMap((b) =>
    b.kind === 'paragraph' || b.kind === 'heading' ? [b.text] : b.kind === 'list' ? b.items : b.kind === 'quote' ? blockTexts(b.blocks) : [],
  );
}

/**
 * Converts a Markdown book into an EPUB 3 package. Chapters start at level-1 headings when there are two or more; with a
 * single level-1 heading (the book title) or none they start at level-2 headings; without either the text is cut into
 * chunks of about 40 blocks. The title comes from front matter, else the only level-1 heading, else the file name.
 */
export function markdownToEpub(bytes: Uint8Array, fileName: string, env: DomEnv): Uint8Array {
  const { meta, body } = splitFrontMatter(decodeTextFile(bytes).split('\n'));
  const blocks = parseMarkdownBlocks(body);
  const split = createInlineSplitter(env);
  if (blocks.length === 0) throw new Error('No translatable text found in this book');
  // Plain titles of the headings; one whose text renders to nothing (markup only) never starts a chapter.
  const titles = new Map<MarkdownBlock, string>();
  for (const b of blocks) if (b.kind === 'heading') titles.set(b, plainHeading(env, b.text).trim());
  const isTitled = (b: MarkdownBlock, level: number) => b.kind === 'heading' && b.level === level && titles.get(b) !== '';
  const levelCount = (level: number) => blocks.filter((b) => isTitled(b, level)).length;
  const h1 = levelCount(1);
  const splitLevel = h1 >= 2 ? 1 : levelCount(2) >= 1 ? 2 : 0;
  const soleH1 = h1 === 1 ? blocks.find((b) => isTitled(b, 1)) : undefined;
  const title = meta.title ?? (soleH1 ? (titles.get(soleH1) ?? '') : '');

  let chapters: TextChapter[];
  if (splitLevel === 0) {
    chapters = chunkChapters(blocks.flatMap((b) => renderBlock(b, split)));
  } else {
    chapters = [];
    let current: TextChapter = { title: '', blocks: [] };
    for (const block of blocks) {
      if (isTitled(block, splitLevel)) {
        if (current.blocks.length) chapters.push(current);
        current = { title: titles.get(block) ?? '', blocks: [] };
      }
      current.blocks.push(...renderBlock(block, split));
    }
    if (current.blocks.length) chapters.push(current);
  }
  const language = canonicalLanguage(meta.lang) ?? detectTextLanguage(blockTexts(blocks));
  return buildTextBook({ title: title || titleFromFileName(fileName), author: meta.author, language, chapters }, env);
}
