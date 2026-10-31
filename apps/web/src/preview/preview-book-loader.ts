import { unzipSync } from 'fflate';
import { removeNetworkHints } from './preview-network-hints';
import type { DataEventDetail, EpubLoader, FoliateBook, LoadEventDetail } from './third-party/foliate-js/epub.js';

/**
 * Policy added to every (X)HTML document the preview renders. The section documents are blob: URLs that inherit the
 * app's CSP (`script-src 'self'`), and exports are already stripped of scripts; this meta makes the guarantee local to
 * each document (also in dev builds, which have no app CSP) because foliate's iframes allow scripts for a WebKit bug.
 */
export const PREVIEW_DOCUMENT_CSP = "script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const MARKUP_TYPES = new Set(['application/xhtml+xml', 'text/html']);
const HEAD_START = /<head(?:\s[^>]*)?>/i;

/** Inserts the script-blocking CSP meta as the first child of `<head>`; markup without a head is returned unchanged. */
export function injectScriptBlockingCsp(markup: string): string {
  return markup.replace(HEAD_START, (head) => `${head}<meta http-equiv="Content-Security-Policy" content="${PREVIEW_DOCUMENT_CSP}"/>`);
}

/** File access over the archive's entries, decoded lazily. */
export function createArchiveLoader(bytes: Uint8Array): EpubLoader {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();
  return {
    loadText: (name) => {
      const data = files[name];
      return data ? decoder.decode(data) : null;
    },
    loadBlob: (name, type) => {
      const data = files[name];
      return data ? new Blob([data as Uint8Array<ArrayBuffer>], type ? { type } : undefined) : null;
    },
    getSize: (name) => files[name]?.byteLength ?? 0,
  };
}

/**
 * Never loads scripts, and rewrites each content document before it gets a blob URL: network hints and meta refresh are
 * removed, and {@link PREVIEW_DOCUMENT_CSP} is added.
 */
export function hardenBook(book: FoliateBook): void {
  const target = book.transformTarget;
  if (!target) throw new Error('The preview reader exposes no resource hooks; refusing to render without them.');
  target.addEventListener('load', (event) => {
    const detail = (event as CustomEvent<LoadEventDetail>).detail;
    if (detail.isScript) detail.allow = false;
  });
  target.addEventListener('data', (event) => {
    const detail = (event as CustomEvent<DataEventDetail>).detail;
    if (!MARKUP_TYPES.has(detail.type)) return;
    detail.data = Promise.resolve(detail.data).then((data) =>
      typeof data === 'string' ? injectScriptBlockingCsp(removeNetworkHints(data, detail.type)) : data,
    );
  });
}

/** Opens EPUB bytes with foliate-js's parser (loaded on demand) and hardens it for rendering. */
export async function openPreviewBook(bytes: Uint8Array): Promise<FoliateBook> {
  const { EPUB } = await import('./third-party/foliate-js/epub.js');
  const book = await new EPUB(createArchiveLoader(bytes)).init();
  hardenBook(book);
  return book;
}
