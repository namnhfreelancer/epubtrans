import { bodyOf, createXhtmlDocument } from '../dom/xhtml-document';
import { NS } from '../dom/xml-dom-helpers';
import { type BuiltChapter, buildEpubPackage, TEXT_DIR, type TocNode } from '../epub/build-epub-package';
import type { DomEnv } from '../types';
import { basename } from '../util/zip-path';

/**
 * Shared plumbing of the plain-text and Markdown converters: decoding, block renderers and the EPUB package of a book
 * made of titled chapters. Every element is built through the DOM (text goes into text nodes), never by concatenating
 * the file's text into markup.
 */

/** Builds one block element of a chapter in the chapter's document. */
export type BlockRenderer = (doc: Document) => Element;

export interface TextChapter {
  /** Chapter title for the table of contents; empty for front matter (the book title is used instead). */
  title: string;
  blocks: BlockRenderer[];
}

export interface TextBook {
  title: string;
  author?: string;
  /** BCP 47 tag, or 'und' when unknown. */
  language: string;
  chapters: TextChapter[];
}

/** Paragraphs per chapter when a text has no recognizable chapter headings. */
export const CHUNK_PARAGRAPHS = 40;

/** Characters XML 1.0 cannot carry (C0 controls except tab and newline, U+FFFE/U+FFFF); they become spaces. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/**
 * Decodes a text file: UTF-16 with a BOM, else UTF-8, else Windows-1252 (the usual encoding of old plain-text books that
 * are not valid UTF-8). Line endings become `\n` and characters XML cannot hold become spaces.
 */
export function decodeTextFile(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n').replace(INVALID_XML_CHARS, ' ');
}

/** A readable title from a file name: no directory or extension, underscores as spaces. */
export function titleFromFileName(fileName: string): string {
  const name = basename(fileName.replace(/\\/g, '/'))
    .replace(/\.[^.]+$/, '')
    .replace(/[_\s]+/g, ' ')
    .trim();
  return name || 'Untitled';
}

/** An element holding plain text. */
export const textElement =
  (tag: string, text: string): BlockRenderer =>
  (doc) => {
    const el = doc.createElementNS(NS.XHTML, tag);
    el.textContent = text;
    return el;
  };

/** Splits blocks into chapters of `size` blocks, numbered from 1 (one chapter keeps the book title). */
export function chunkChapters(blocks: BlockRenderer[], size = CHUNK_PARAGRAPHS): TextChapter[] {
  if (blocks.length <= size) return [{ title: '', blocks }];
  const chapters: TextChapter[] = [];
  for (let i = 0; i < blocks.length; i += size) chapters.push({ title: String(chapters.length + 1), blocks: blocks.slice(i, i + size) });
  return chapters;
}

const chapterFileName = (i: number) => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;

/** Writes the chapters as an EPUB 3 package (with NCX), one content document per chapter. */
export function buildTextBook(book: TextBook, env: DomEnv): Uint8Array {
  const chapters = book.chapters.filter((c) => c.blocks.length > 0);
  if (chapters.length === 0) throw new Error('No translatable text found in this book');
  const language = book.language && book.language !== 'und' ? book.language : undefined;
  const built: BuiltChapter[] = [];
  const toc: TocNode[] = [];
  chapters.forEach((chapter, i) => {
    const fileName = chapterFileName(i);
    const label = chapter.title || book.title;
    const doc = createXhtmlDocument(env, label, language);
    const body = bodyOf(doc);
    for (const render of chapter.blocks) body.appendChild(render(doc));
    built.push({ fileName, doc });
    toc.push({ label, href: `${TEXT_DIR}/${fileName}` });
  });
  return buildEpubPackage({ metadata: { title: book.title, author: book.author, language }, chapters: built, resources: [], toc }, env);
}
