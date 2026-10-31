import { byLocalName, firstByLocalName } from '../dom/xml-dom-helpers';
import type { PackageInfo } from '../epub/package-document';
import { relativeHref } from '../util/zip-path';

/** An id not used yet anywhere in the package document: `base`, else `base-2`, `base-3`, … */
export function freePackageId(pkg: PackageInfo, base: string): string {
  const used = new Set(Array.from(pkg.opf.querySelectorAll('[id]'), (el) => el.getAttribute('id')));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Appends a manifest item for the container path `path` (unless an item with `id` exists). The item is cloned from an
 * existing one so it keeps the package's namespace and prefix, then stripped of every attribute.
 */
export function addManifestItem(pkg: PackageInfo, id: string, path: string, mediaType: string): void {
  const manifest = firstByLocalName(pkg.opf, 'manifest');
  const sample = manifest ? byLocalName(manifest, 'item')[0] : undefined;
  if (!manifest || !sample || byLocalName(manifest, 'item').some((i) => i.getAttribute('id') === id)) return;
  const item = sample.cloneNode(false) as Element;
  for (const attr of Array.from(item.attributes)) item.removeAttribute(attr.name);
  item.setAttribute('id', id);
  item.setAttribute('href', relativeHref(pkg.opfPath, path));
  item.setAttribute('media-type', mediaType);
  manifest.appendChild(item);
}

/** Appends a linear spine entry for manifest item `id` (cloned from an existing itemref, like manifest items). */
export function appendSpineItem(pkg: PackageInfo, id: string): boolean {
  const spine = firstByLocalName(pkg.opf, 'spine');
  const sample = spine ? byLocalName(spine, 'itemref')[0] : undefined;
  if (!spine || !sample) return false;
  const ref = sample.cloneNode(false) as Element;
  for (const attr of Array.from(ref.attributes)) ref.removeAttribute(attr.name);
  ref.setAttribute('idref', id);
  spine.appendChild(ref);
  return true;
}
