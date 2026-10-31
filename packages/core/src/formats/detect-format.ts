import type { BookFormat } from '../types';
import { decodeMarkup } from '../util/text-encoding';
import { readZip } from '../util/zip-archive';

export type DetectedInput = { format: BookFormat; bytes: Uint8Array };

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/**
 * Detects the book format from magic bytes (the file name is only a tie-breaker).
 * A zip holding a single `.fb2` (common `.fb2.zip` distribution) is unwrapped.
 */
export function detectFormat(bytes: Uint8Array, fileName: string): DetectedInput {
  if (bytes.length < 4) throw new Error('File is empty or truncated');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (ascii(bytes, 30, 38) === 'mimetype' && ascii(bytes, 38, 58).startsWith('application/epub+zip')) {
      return { format: 'epub', bytes };
    }
    const files = readZip(bytes);
    if (files.has('META-INF/container.xml')) return { format: 'epub', bytes };
    const fb2 = [...files.entries()].filter(([name]) => name.toLowerCase().endsWith('.fb2'));
    if (fb2.length === 1 && fb2[0]) return { format: 'fb2', bytes: fb2[0][1] };
    throw new Error('Zip archive is neither an EPUB nor a zipped FB2 book');
  }
  if (bytes.length >= 68 && ascii(bytes, 60, 68) === 'BOOKMOBI') {
    return { format: isKf8(bytes) || /\.azw3$/i.test(fileName) ? 'azw3' : 'mobi', bytes };
  }
  if (ascii(bytes, 60, 68) === 'TEXtREAd') throw new Error('Plain PalmDOC files are not supported');
  const head = decodeMarkup(bytes.subarray(0, 4096));
  if (/<FictionBook[\s>]/.test(head)) return { format: 'fb2', bytes };
  // Plain text has no signature: the extension decides, and binary content is refused.
  const textFormat = MARKDOWN_NAME.test(fileName) ? 'md' : TEXT_NAME.test(fileName) ? 'txt' : undefined;
  if (textFormat) {
    if (looksBinary(bytes)) throw new Error(`Unsupported file format: ${fileName} is not a text file`);
    return { format: textFormat, bytes };
  }
  throw new Error(`Unsupported file format: ${fileName}. Supported: EPUB, MOBI, AZW3, FB2, TXT, Markdown`);
}

const MARKDOWN_NAME = /\.(?:md|markdown)$/i;
const TEXT_NAME = /\.txt$/i;

/** NUL bytes in the first 8 KB mean binary data (UTF-16 text with a BOM is allowed: it has NULs by design). */
function looksBinary(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false;
  return bytes.subarray(0, 8192).includes(0);
}

/** KF8 when the MOBI header version is >= 8 (the file may also be a MOBI6/KF8 combo). */
function isKf8(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const record0 = view.getUint32(78);
  if (record0 + 40 > bytes.length) return false;
  return view.getUint32(record0 + 36) >= 8;
}
