import { createXhtmlDocument } from '../dom/xhtml-document';
import { NS, textOf } from '../dom/xml-dom-helpers';
import { detectTextLanguage } from '../lang/detect-language';
import type { DomEnv } from '../types';
import { type MarkdownBlock, parseMarkdownBlocks, splitOversizedBlocks } from './markdown-blocks';
import { splitFrontMatter } from './markdown-front-matter';
import { renderInline } from './markdown-inline';
import { type BlockRenderer, buildTextBook, chunkChapters, decodeTextFile, type TextChapter, titleFromFileName } from './text-book';

function renderBlock(block: MarkdownBlock): BlockRenderer {
  return (doc) => {
    const el = (tag: string, text?: string) => {
      const node = doc.createElementNS(NS.XHTML, tag);
      if (text !== undefined) for (const n of renderInline(doc, text)) node.appendChild(n);
      return node;
    };
    switch (block.kind) {
      case 'heading':
        return el(`h${block.level}`, block.text);
      case 'paragraph':
        return el('p', block.text);
      case 'rule':
        return el('hr');
      case 'code': {
        const pre = el('pre');
        const code = el('code');
        code.textContent = block.text;
        pre.appendChild(code);
        return pre;
      }
      case 'quote': {
        const quote = el('blockquote');
        for (const inner of block.blocks) quote.appendChild(renderBlock(inner)(doc));
        // An empty quote would be an empty block element; give it a paragraph so the document stays meaningful.
        if (!quote.firstChild) quote.appendChild(el('p'));
        return quote;
      }
      case 'list': {
        const list = el(block.ordered ? 'ol' : 'ul');
        if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
        for (const item of block.items) list.appendChild(el('li', item));
        return list;
      }
    }
  };
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
  const blocks = splitOversizedBlocks(parseMarkdownBlocks(body));
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
    chapters = chunkChapters(blocks.map(renderBlock));
  } else {
    chapters = [];
    let current: TextChapter = { title: '', blocks: [] };
    for (const block of blocks) {
      if (isTitled(block, splitLevel)) {
        if (current.blocks.length) chapters.push(current);
        current = { title: titles.get(block) ?? '', blocks: [] };
      }
      current.blocks.push(renderBlock(block));
    }
    if (current.blocks.length) chapters.push(current);
  }
  const language = canonicalLanguage(meta.lang) ?? detectTextLanguage(blockTexts(blocks));
  return buildTextBook({ title: title || titleFromFileName(fileName), author: meta.author, language, chapters }, env);
}
