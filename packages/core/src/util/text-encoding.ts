const utf8 = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export const encodeUtf8 = (text: string): Uint8Array => encoder.encode(text);

/**
 * Decodes markup bytes honoring a BOM or an XML/HTML encoding declaration.
 * Falls back to UTF-8 when the declared encoding is unknown to TextDecoder.
 */
export function decodeMarkup(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = String.fromCharCode(...bytes.subarray(0, 512));
  const declared =
    /^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._-]+)/i.exec(head)?.[1];
  let text: string;
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      text = new TextDecoder(declared).decode(bytes);
    } catch {
      text = utf8.decode(bytes);
    }
  } else {
    text = utf8.decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** True when the text contains at least one letter in any script. */
export const hasLetters = (text: string): boolean => /\p{L}/u.test(text);

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
