import { type HtmlTag, tokenizeTags } from './html-tag-tokenizer';

/**
 * DOM-free validation of model output against the source segment markup.
 * Both sides are scanned with an HTML-conformant tag tokenizer, so the comparison sees the
 * same tags and attributes an HTML parser builds at export. It is deliberately strict: any tag
 * or attribute that is not in the source (with the same value) is a mismatch.
 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Active or raw-text elements: never accepted in a translation, even when the source has them. */
const FORBIDDEN = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'textarea',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'template',
]);

/** Comments, doctypes, CDATA, processing instructions and bogus end tags hide markup from a tag scanner. */
const HIDDEN_MARKUP = /<[!?]|<\/(?![A-Za-z])/;

interface TagCounts {
  /** Opening/self-closing tag signatures: name plus sorted attributes. */
  open: Map<string, number>;
  /** Closing tags expected from non-void opening tags. */
  expectedClose: Map<string, number>;
  close: Map<string, number>;
}

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

function countTags(tags: HtmlTag[]): TagCounts {
  const open = new Map<string, number>();
  const expectedClose = new Map<string, number>();
  const close = new Map<string, number>();
  for (const tag of tags) {
    if (tag.end) {
      if (!VOID.has(tag.name)) bump(close, tag.name);
      continue;
    }
    const attrs = tag.attrs.map((a) => JSON.stringify(a)).sort();
    bump(open, JSON.stringify([tag.name, ...attrs]));
    if (VOID.has(tag.name)) continue;
    bump(expectedClose, tag.name);
    if (tag.selfClosing) bump(close, tag.name);
  }
  return { open, expectedClose, close };
}

const sameCounts = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/**
 * Returns an error message when `translation` does not preserve the source markup
 * (same tags with identical attributes, balanced closing tags, non-empty text), else undefined.
 */
export function validateTranslationMarkup(sourceHtml: string, translation: string): string | undefined {
  if (!translation.replace(/<[^>]*>/g, '').trim()) return 'empty translation';
  if (HIDDEN_MARKUP.test(translation)) return 'forbidden markup';
  const tags = tokenizeTags(translation);
  if (!tags) return 'unterminated tag';
  if (tags.some((t) => FORBIDDEN.has(t.name))) return 'forbidden markup';
  const src = countTags(tokenizeTags(sourceHtml) ?? []);
  const out = countTags(tags);
  if (!sameCounts(src.open, out.open)) return 'inline tags or attributes were not preserved';
  for (const name of new Set([...out.close.keys(), ...out.expectedClose.keys()])) {
    if (out.close.get(name) !== out.expectedClose.get(name)) return `unbalanced <${name}> tags`;
  }
  return undefined;
}
