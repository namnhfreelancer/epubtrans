import { serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName, NS, parseXml, textOf } from '../dom/xml-dom-helpers';
import { type PackageInfo, readEncryptedPaths, readText } from '../epub/package-document';
import type { DomEnv, ExportMode, Project } from '../types';
import { uuidV5 } from '../util/name-based-uuid';
import { encodeUtf8 } from '../util/text-encoding';
import type { FileMap } from '../util/zip-archive';
import { freePackageId } from './manifest-items';

/** Namespace of epubtrans export identifiers (a fixed random UUID; changing it would change every exported id). */
const EXPORT_ID_NAMESPACE = '6f0d3c9e-2b1a-4e57-9c8d-5a4b3e2f1d07';

const ID_ELEMENT_NAME = 'epubtrans-uid';
const GENERATED_ID_ELEMENT = /^epubtrans-uid(?:-\d+)?$/;

const identifiersOf = (pkg: PackageInfo): Element[] => {
  const metadata = firstByLocalName(pkg.opf, 'metadata');
  return metadata ? byLocalName(metadata, 'identifier') : [];
};

/** The `dc:identifier` the package's `unique-identifier` names, else the first one. */
function uniqueIdentifierElement(pkg: PackageInfo): Element | undefined {
  const ids = identifiersOf(pkg);
  const uid = pkg.opf.documentElement.getAttribute('unique-identifier');
  return (uid ? ids.find((el) => el.getAttribute('id') === uid) : undefined) ?? ids[0];
}

/** An identifier an earlier epubtrans export generated (the book being exported is itself an epubtrans export). */
const isGeneratedIdentifier = (el: Element): boolean => GENERATED_ID_ELEMENT.test(el.getAttribute('id') ?? '') && textOf(el).trim().startsWith('urn:uuid:');

/**
 * The source book's identifier: the `dc:identifier` its `unique-identifier` names, else the first one. When that is an
 * identifier an earlier epubtrans export generated, the original book's identifier is used instead (the one that
 * export recorded as `dc:source`, else the first identifier it kept), so exporting an export again stays stable.
 */
export function sourceIdentifier(pkg: PackageInfo): string | undefined {
  const unique = uniqueIdentifierElement(pkg);
  if (!unique || !isGeneratedIdentifier(unique)) return textOf(unique).trim() || undefined;
  const kept = identifiersOf(pkg)
    .filter((el) => !isGeneratedIdentifier(el))
    .map((el) => textOf(el).trim())
    .filter(Boolean);
  const metadata = firstByLocalName(pkg.opf, 'metadata');
  const sources = new Set((metadata ? byLocalName(metadata, 'source') : []).map((el) => textOf(el).trim()));
  return kept.find((id) => sources.has(id)) ?? kept[0];
}

/**
 * Stable identifier of an export: a name-based UUID (version 5) of the source book's identifier (or its title when it
 * has none), the target language and the export mode, so re-exporting the same book the same way gives the same id
 * and a reading system keeps different translations and layouts apart.
 */
export function exportIdentifier(sourceId: string, targetLang: string, mode: ExportMode): string {
  return `urn:uuid:${uuidV5(EXPORT_ID_NAMESPACE, `${sourceId}\n${targetLang.toLowerCase()}\n${mode}`)}`;
}

/**
 * Gives every rendition the export's own `dc:identifier` and points `unique-identifier` (and the NCX `dtb:uid`) at it.
 * The source identifiers stay as additional `dc:identifier`s, and the source id is added as `dc:source` unless one
 * already says so. An identifier an earlier epubtrans export generated is reused (given the new value), not repeated. Books with obfuscated fonts (anything listed in META-INF/encryption.xml) keep their identifier:
 * the obfuscation key is derived from it, so a new one would turn the fonts into garbage. Returns the identifier the
 * export carries.
 */
export function applyExportIdentifier(files: FileMap, renditions: readonly PackageInfo[], project: Project, mode: ExportMode, env: DomEnv): string | undefined {
  const primary = renditions[0];
  if (!primary) return undefined;
  // The obfuscation key is derived from the package's actual unique identifier, whatever made it.
  if (readEncryptedPaths(files, env).size > 0) return textOf(uniqueIdentifierElement(primary)).trim() || undefined;
  const id = exportIdentifier(sourceIdentifier(primary) ?? project.title, project.settings.targetLang, mode);
  for (const pkg of renditions) setPackageIdentifier(pkg, id);
  for (const pkg of renditions) if (pkg.ncx && files.has(pkg.ncx.path)) setNcxUid(files, pkg.ncx.path, id, env);
  return id;
}

function setPackageIdentifier(pkg: PackageInfo, id: string): void {
  const metadata = firstByLocalName(pkg.opf, 'metadata');
  if (!metadata) return;
  const previous = sourceIdentifier(pkg);
  const doc = pkg.opf;
  // A dc element with the package's own prefix binding, so EPUB 2 and EPUB 3 serializations stay alike.
  const sample = byLocalName(metadata, 'identifier')[0] ?? byLocalName(metadata, 'title')[0];
  const qualified = (local: string) => (sample?.prefix ? `${sample.prefix}:${local}` : `dc:${local}`);
  let element = identifiersOf(pkg).find(isGeneratedIdentifier);
  if (!element) {
    element = doc.createElementNS(NS.DC, qualified('identifier'));
    element.setAttribute('id', freePackageId(pkg, ID_ELEMENT_NAME));
    metadata.insertBefore(element, metadata.firstChild);
  }
  element.textContent = id;
  doc.documentElement.setAttribute('unique-identifier', element.getAttribute('id') as string);
  if (previous && !byLocalName(metadata, 'source').some((s) => textOf(s).trim() === previous)) {
    const source = doc.createElementNS(NS.DC, qualified('source'));
    source.textContent = previous;
    element.parentNode?.insertBefore(source, element.nextSibling);
  }
}

/** EPUB 2 requires the NCX `dtb:uid` to equal the package's unique identifier. */
function setNcxUid(files: FileMap, path: string, id: string, env: DomEnv): void {
  const doc = parseXml(env, readText(files, path), path);
  const meta = byLocalName(doc, 'meta').find((m) => m.getAttribute('name') === 'dtb:uid');
  if (!meta) return;
  meta.setAttribute('content', id);
  files.set(path, encodeUtf8(serializeXmlDocument(env, doc)));
}
