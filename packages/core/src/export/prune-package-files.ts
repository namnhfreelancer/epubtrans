import { byLocalName } from '../dom/xml-dom-helpers';
import type { PackageInfo } from '../epub/package-document';
import { normalizeMediaType } from '../util/media-type';
import type { FileMap } from '../util/zip-archive';
import { dirname, resolvePath } from '../util/zip-path';

const XSL_PATH = /\.xslt?$/i;
const XSL_MEDIA_TYPES = new Set(['application/xslt+xml', 'text/xsl']);

/**
 * Removes files an exported package must not carry:
 * - XSLT stylesheets (by extension or media type), with their manifest items in every rendition:
 *   EPUB has no use for them and a browser runs the markup they generate;
 * - every file no package document references. Kept are `mimetype`, `META-INF/**`, every
 *   rootfile of `META-INF/container.xml` (`rootfiles`, including those that are not parsed OPFs),
 *   and for each parsed rendition its manifest items and the local targets of its OPF `<link>`
 *   elements (EPUB 3 linked metadata records are not manifest items).
 * What is kept is then sanitized by content as well as by type (`stripActiveContentFromPackage`),
 * so no file escapes through an unusual extension or media type.
 */
export function prunePackageFiles(files: FileMap, renditions: PackageInfo[], rootfiles: string[]): void {
  const referenced = new Set(rootfiles);
  for (const pkg of renditions) {
    const xslIds = new Set(pkg.manifest.filter((m) => isXsl(m.path, m.mediaType)).map((m) => m.id));
    if (xslIds.size > 0) removeManifestItems(pkg, xslIds);
    const opfDir = dirname(pkg.opfPath);
    referenced.add(pkg.opfPath);
    for (const item of pkg.manifest) referenced.add(item.path);
    for (const link of byLocalName(pkg.opf, 'link')) referenced.add(resolvePath(opfDir, link.getAttribute('href') ?? ''));
  }
  for (const path of Array.from(files.keys())) {
    if (XSL_PATH.test(path)) files.delete(path);
    else if (path !== 'mimetype' && !path.startsWith('META-INF/') && !referenced.has(path)) files.delete(path);
  }
}

function isXsl(path: string, mediaType: string): boolean {
  return XSL_PATH.test(path) || XSL_MEDIA_TYPES.has(normalizeMediaType(mediaType));
}

/** Drops manifest items from `pkg` and the OPF, with the spine entries and fallbacks that point to them. */
function removeManifestItems(pkg: PackageInfo, ids: Set<string>): void {
  pkg.manifest = pkg.manifest.filter((m) => !ids.has(m.id));
  pkg.spine = pkg.spine.filter((m) => !ids.has(m.id));
  for (const el of byLocalName(pkg.opf, 'item')) {
    if (ids.has(el.getAttribute('id') ?? '')) el.parentNode?.removeChild(el);
    else if (ids.has(el.getAttribute('fallback') ?? '')) el.removeAttribute('fallback');
  }
  for (const ref of byLocalName(pkg.opf, 'itemref')) {
    if (ids.has(ref.getAttribute('idref') ?? '')) ref.parentNode?.removeChild(ref);
  }
}
