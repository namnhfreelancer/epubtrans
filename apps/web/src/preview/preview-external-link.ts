const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** The link target when it is an absolute http(s) or mailto URL; anything else (javascript:, data:, blob:, relative) is not opened. */
export function externalLinkTarget(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim());
    return EXTERNAL_SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Opens an external link from a book in a new tab with no reference back to the app window and no Referer. */
export function openExternalLink(href: string | null | undefined): void {
  const target = externalLinkTarget(href);
  if (target) window.open(target, '_blank', 'noopener,noreferrer');
}
