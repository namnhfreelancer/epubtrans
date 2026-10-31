import { normalizeMediaType } from '../util/media-type';
import { scanProlog } from './xml-prolog';

export type MarkupKind = 'xhtml' | 'svg' | 'xml';

/** Extensions a browser parses as HTML when the file is served over HTTP. */
const HTML_PARSED_PATH = /\.s?html?$/i;

/**
 * How a reading system or browser may interpret a package file, from its path and declared media
 * type. Files a browser parses as HTML by extension are always XHTML (so they are rebuilt),
 * whatever their declared media type; otherwise the manifest media type (parameters ignored)
 * decides, else the extension. Files this does not classify may still be markup by content
 * (`startsWithMarkup`).
 */
export function markupKindOf(path: string, mediaType = ''): MarkupKind | undefined {
  const type = normalizeMediaType(mediaType);
  if (HTML_PARSED_PATH.test(path) || type === 'application/xhtml+xml' || type === 'text/html') return 'xhtml';
  if (type === 'image/svg+xml') return 'svg';
  if (/[/+]xml$/.test(type)) return 'xml';
  if (/\.xht(?:ml)?$/i.test(path)) return 'xhtml';
  if (/\.svg$/i.test(path)) return 'svg';
  if (/\.xml$/i.test(path)) return 'xml';
  return undefined;
}

/**
 * Extensions of stylesheets, scripts, images, fonts, audio, video, PDF, plain text and JSON. Static
 * servers map them to non-markup media types, so a browser never parses such a file as HTML or XML
 * whatever its bytes, while valid files may start with `<` (CSS with a leading `<!--`, an obfuscated
 * font whose first stored byte happens to be `<`). Unknown extensions are not listed: a server may
 * send those without a media type, and a browser then sniffs markup.
 */
const NON_MARKUP_PATH =
  /\.(?:css|m?js|jpe?g|png|gif|webp|avif|bmp|ico|tiff?|ttf|otf|woff2?|eot|mp3|m4a|aac|og[ag]|opus|wav|flac|mp4|m4v|webm|ogv|pdf|txt|json)$/i;

/** True for a path whose extension marks a non-markup resource (see `NON_MARKUP_PATH`). */
export const isNonMarkupPath = (path: string): boolean => NON_MARKUP_PATH.test(path);

/** Whitespace an XML or HTML parser skips before the first tag (XML S plus form feed). */
const LEADING_SPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c]);
const LT = 0x3c;

/**
 * True when the first non-whitespace character of the file is `<` (after an optional UTF-8 or
 * UTF-16 byte order mark): a browser or static server may treat such a file as markup whatever
 * its declared media type. No image, font, audio or video signature begins with `<`, but an
 * obfuscated font or a CSS file may, so callers skip those first (`isNonMarkupPath`, encrypted
 * resources).
 */
export function startsWithMarkup(data: Uint8Array): boolean {
  const byte = (k: number) => data[k] ?? -1;
  /** ASCII character at offset `k`, or -1 (also for non-ASCII UTF-16 code units). */
  let char = byte;
  let i = 0;
  let step = 1;
  if (byte(0) === 0xef && byte(1) === 0xbb && byte(2) === 0xbf) i = 3;
  else if (byte(0) === 0xff && byte(1) === 0xfe) {
    [i, step] = [2, 2];
    char = (k) => (byte(k + 1) === 0 ? byte(k) : -1);
  } else if (byte(0) === 0xfe && byte(1) === 0xff) {
    [i, step] = [2, 2];
    char = (k) => (byte(k) === 0 ? byte(k + 1) : -1);
  }
  while (LEADING_SPACE.has(char(i))) i += step;
  return char(i) === LT;
}

/**
 * Kind of a file recognized as markup by content: XHTML when the document element is `html`, SVG
 * when it is `svg`, otherwise generic XML (which is replaced by a stand-in when it does not parse).
 */
export function sniffMarkupKind(markup: string): MarkupKind {
  const root = scanProlog(markup).root;
  return root === 'html' ? 'xhtml' : root === 'svg' ? 'svg' : 'xml';
}
