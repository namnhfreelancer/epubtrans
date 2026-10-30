/**
 * Segment markup comes from untrusted books and model answers. For display it is reduced to
 * attribute-free inline formatting: block and unknown elements are unwrapped, active content is dropped.
 * (The exported EPUB keeps the original markup; this only protects the app origin, which holds API keys.)
 */
const KEEP = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'code',
  'span',
  'br',
  'mark',
  'q',
  'cite',
  'abbr',
  'dfn',
  'kbd',
  'samp',
  'var',
  'del',
  'ins',
  'bdi',
  'ruby',
  'rt',
  'rp',
  'wbr',
]);
const DROP = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'svg',
  'math',
  'link',
  'meta',
  'img',
  'video',
  'audio',
  'canvas',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'frame',
  'frameset',
  'base',
  'title',
  'head',
]);

function clean(parent: Node, doc: Document): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      parent.removeChild(node);
      continue;
    }
    const el = node as Element;
    const name = el.localName.toLowerCase();
    if (DROP.has(name)) {
      parent.removeChild(el);
      continue;
    }
    clean(el, doc);
    if (KEEP.has(name)) {
      const copy = doc.createElement(name);
      while (el.firstChild) copy.appendChild(el.firstChild);
      parent.replaceChild(copy, el);
    } else {
      // Unwrap: keep the children, separating block content with a space.
      const fragment = doc.createDocumentFragment();
      while (el.firstChild) fragment.appendChild(el.firstChild);
      fragment.appendChild(doc.createTextNode(' '));
      parent.replaceChild(fragment, el);
    }
  }
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 4000;

export function sanitizeSegmentHtml(html: string): string {
  const hit = cache.get(html);
  if (hit !== undefined) return hit;
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  clean(doc.body, doc);
  const result = doc.body.innerHTML.trim();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(html, result);
  return result;
}
