import { type HtmlTag, tokenizeTags } from './html-tag-tokenizer';

/**
 * DOM-free validation of model output against the source segment markup.
 * Both sides are scanned with an HTML-conformant tag tokenizer, so the comparison sees the
 * same tags and attributes an HTML parser builds at export. It is deliberately strict: any tag
 * or attribute that is not in the source (with the same value) is a mismatch.
 */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Active or raw-text elements: never accepted in a translation, even when the source has them. */
export const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
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
export const HIDDEN_MARKUP = /<[!?]|<\/(?![A-Za-z])/;

interface TagCounts {
  /** Opening/self-closing tag signatures: name plus sorted attributes. */
  open: Map<string, number>;
  /** Readable form of each signature, for error messages. */
  labels: Map<string, string>;
  /** Closing tags expected from non-void opening tags. */
  expectedClose: Map<string, number>;
  close: Map<string, number>;
}

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

const MAX_LABEL_VALUE = 40;
const MAX_LISTED_DIFFERENCES = 6;

const truncate = (value: string) => (value.length > MAX_LABEL_VALUE ? `${value.slice(0, MAX_LABEL_VALUE)}…` : value);

/** `<a id="nr4-11">`: how a tag signature is shown in a validation error. */
const tagLabel = (tag: HtmlTag) => `<${tag.name}${tag.attrs.map(([n, v]) => ` ${n}="${truncate(v)}"`).join('')}>`;

function countTags(tags: HtmlTag[]): TagCounts {
  const open = new Map<string, number>();
  const labels = new Map<string, string>();
  const expectedClose = new Map<string, number>();
  const close = new Map<string, number>();
  for (const tag of tags) {
    if (tag.end) {
      if (!VOID_ELEMENTS.has(tag.name)) bump(close, tag.name);
      continue;
    }
    const attrs = tag.attrs.map((a) => JSON.stringify(a)).sort();
    const key = JSON.stringify([tag.name, ...attrs]);
    bump(open, key);
    if (!labels.has(key)) labels.set(key, tagLabel(tag));
    if (VOID_ELEMENTS.has(tag.name)) continue;
    bump(expectedClose, tag.name);
    if (tag.selfClosing) bump(close, tag.name);
  }
  return { open, labels, expectedClose, close };
}

/** Lists the tag signatures the translation lost or gained, e.g. `missing <a id="n1">; unexpected <b> ×2`. */
function describeTagDifferences(src: TagCounts, out: TagCounts): string {
  const missing: string[] = [];
  const unexpected: string[] = [];
  for (const key of new Set([...src.open.keys(), ...out.open.keys()])) {
    const delta = (src.open.get(key) ?? 0) - (out.open.get(key) ?? 0);
    if (delta === 0) continue;
    const label = `${src.labels.get(key) ?? out.labels.get(key) ?? key}${Math.abs(delta) > 1 ? ` ×${Math.abs(delta)}` : ''}`;
    (delta > 0 ? missing : unexpected).push(label);
  }
  const parts = [...missing.map((l) => `missing ${l}`), ...unexpected.map((l) => `unexpected ${l}`)];
  const listed = parts.slice(0, MAX_LISTED_DIFFERENCES).join('; ');
  return parts.length > MAX_LISTED_DIFFERENCES ? `${listed}; … (${parts.length - MAX_LISTED_DIFFERENCES} more)` : listed;
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
  if (tags.some((t) => FORBIDDEN_ELEMENTS.has(t.name))) return 'forbidden markup';
  const src = countTags(tokenizeTags(sourceHtml) ?? []);
  const out = countTags(tags);
  if (!sameCounts(src.open, out.open)) return `inline tags or attributes were not preserved: ${describeTagDifferences(src, out)}`;
  for (const name of new Set([...out.close.keys(), ...out.expectedClose.keys()])) {
    if (out.close.get(name) !== out.expectedClose.get(name)) return `unbalanced <${name}> tags`;
  }
  return undefined;
}
