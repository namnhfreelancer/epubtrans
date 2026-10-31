/**
 * Removes the constructs that make a content document reach the network or navigate away on their own, which the
 * document CSP does not cover: `<meta http-equiv="refresh">` (navigates the section frame, or reloads it forever)
 * and `<link rel=prefetch|preconnect|dns-prefetch|prerender|preload|modulepreload>` (browsers fetch these regardless
 * of `default-src`, which tells a remote host that and when the book was previewed). Applied to the preview's copy of
 * each section only, so the downloaded EPUB is unchanged.
 */

const HINT_RELS = new Set(['prefetch', 'preconnect', 'dns-prefetch', 'prerender', 'preload', 'modulepreload']);
/** Cheap pre-check so documents without any such markup skip the parse and re-serialisation. */
const MAYBE_HINTS = /refresh|prefetch|preconnect|prerender|preload/i;

const isRefreshMeta = (meta: Element): boolean => (meta.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'refresh';
const isHintLink = (link: Element): boolean =>
  (link.getAttribute('rel') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .some((token) => HINT_RELS.has(token));

/** Returns `markup` without refresh metas and network-hint links; unparsable or unaffected markup is returned unchanged. */
export function removeNetworkHints(markup: string, type: string): string {
  if (!MAYBE_HINTS.test(markup)) return markup;
  const isXml = type !== 'text/html';
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, isXml ? 'application/xhtml+xml' : 'text/html');
  } catch {
    return markup;
  }
  // A well-formedness error yields an error document, which the browser would not render as a section either.
  if (isXml && doc.getElementsByTagName('parsererror').length > 0) return markup;
  const doomed = [...Array.from(doc.querySelectorAll('meta')).filter(isRefreshMeta), ...Array.from(doc.querySelectorAll('link')).filter(isHintLink)];
  if (doomed.length === 0) return markup;
  for (const el of doomed) el.remove();
  return isXml ? new XMLSerializer().serializeToString(doc) : `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}
