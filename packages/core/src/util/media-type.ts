/** EPUB core media types we can emit, detected from magic bytes. */
export interface SniffedType {
  mediaType: string;
  extension: string;
}

export function sniffMediaType(data: Uint8Array): SniffedType | undefined {
  const b = data;
  const ascii = (start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mediaType: 'image/jpeg', extension: 'jpg' };
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return { mediaType: 'image/png', extension: 'png' };
  if (ascii(0, 4) === 'GIF8') return { mediaType: 'image/gif', extension: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mediaType: 'image/webp', extension: 'webp' };
  if (ascii(0, 4) === 'wOFF') return { mediaType: 'font/woff', extension: 'woff' };
  if (ascii(0, 4) === 'wOF2') return { mediaType: 'font/woff2', extension: 'woff2' };
  if (ascii(0, 4) === 'OTTO') return { mediaType: 'font/otf', extension: 'otf' };
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || ascii(0, 4) === 'true') {
    return { mediaType: 'font/ttf', extension: 'ttf' };
  }
  const head = ascii(0, 256);
  if (/<svg[\s>]/.test(head) || (/^\s*<\?xml/.test(head) && /<svg/.test(ascii(0, 2048)))) {
    return { mediaType: 'image/svg+xml', extension: 'svg' };
  }
  return undefined;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Media type essence for comparisons: parameters (`; charset=...`) dropped, trimmed and lower-cased. */
export function normalizeMediaType(mediaType: string): string {
  return (mediaType.split(';')[0] ?? '').trim().toLowerCase();
}
