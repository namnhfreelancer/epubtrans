/**
 * DOM-free validation of model output against the source segment markup.
 * Source markup comes from our deterministic serializer, so a tag scanner is reliable there;
 * for model output it is deliberately strict: any tag or attribute change is a mismatch.
 */
const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const decodeAttr = (v: string) =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

interface TagScan {
  /** Opening/self-closing tag signatures: name plus sorted attributes. */
  open: Map<string, number>;
  close: Map<string, number>;
}

function scan(html: string): TagScan {
  const open = new Map<string, number>();
  const close = new Map<string, number>();
  for (const m of html.matchAll(TAG)) {
    const name = (m[2] ?? '').toLowerCase();
    if (m[1]) {
      close.set(name, (close.get(name) ?? 0) + 1);
      continue;
    }
    const attrs: string[] = [];
    for (const a of (m[3] ?? '').matchAll(ATTR)) {
      attrs.push(`${(a[1] ?? '').toLowerCase()}=${decodeAttr(a[2] ?? a[3] ?? a[4] ?? '')}`);
    }
    const sig = `${name}|${attrs.sort().join('|')}`;
    open.set(sig, (open.get(sig) ?? 0) + 1);
    if (m[4] && !VOID.has(name)) close.set(name, (close.get(name) ?? 0) + 1);
  }
  return { open, close };
}

const sameCounts = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/**
 * Returns an error message when `translation` does not preserve the source markup
 * (same tags with identical attributes, balanced closing tags, non-empty text), else undefined.
 */
export function validateTranslationMarkup(sourceHtml: string, translation: string): string | undefined {
  if (!translation.replace(/<[^>]*>/g, '').trim()) return 'empty translation';
  const src = scan(sourceHtml);
  const out = scan(translation);
  if (!sameCounts(src.open, out.open)) return 'inline tags or attributes were not preserved';
  const expectedClose = new Map<string, number>();
  for (const [sig, n] of out.open) {
    const name = sig.split('|')[0] ?? '';
    if (!VOID.has(name)) expectedClose.set(name, (expectedClose.get(name) ?? 0) + n);
  }
  for (const [name, n] of out.close) {
    if (VOID.has(name)) continue;
    if (expectedClose.get(name) !== n) return `unbalanced <${name}> tags`;
  }
  for (const [name, n] of expectedClose) if ((out.close.get(name) ?? 0) !== n) return `unbalanced <${name}> tags`;
  if (/<\s*(script|style|iframe|object)/i.test(translation)) return 'forbidden markup';
  return undefined;
}
