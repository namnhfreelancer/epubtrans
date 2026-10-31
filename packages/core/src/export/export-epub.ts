import { SEGMENT_ATTR } from '../dom/fragment-markup';
import { ensureStylesheet, exportDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName, parseXml, textOf } from '../dom/xml-dom-helpers';
import { isEpub2Package, type PackageInfo, parsePackage, readText } from '../epub/package-document';
import type { DomEnv, ExportMode, Project, Segment } from '../types';
import { encodeUtf8 } from '../util/text-encoding';
import { type FileMap, readZip, writeEpubZip } from '../util/zip-archive';
import { dirname, relativeHref } from '../util/zip-path';
import { prunePackageFiles } from './prune-package-files';
import { type PlacementContext, placeTranslation, SOURCE_CLASS, setLang, textLabel } from './segment-placement';
import { stripActiveContent, stripActiveContentFromPackage, unmarkScripted } from './strip-active-content';

export const EXPORT_MODES: ExportMode[] = ['bilingual', 'bilingual-translation-first', 'translation-only'];

const STYLESHEET = `/* epubtrans: bilingual layout */\n.${SOURCE_CLASS} { opacity: 0.55; }\n`;
const STYLESHEET_NAME = 'epubtrans.css';

const isDone = (s: Segment | undefined): s is Segment & { translationHtml: string } =>
  !!s?.translationHtml && (s.status === 'translated' || s.status === 'reviewed');

/**
 * Builds the output EPUB. Untranslated segments keep their source text. Segment markers are
 * removed, translated blocks get `lang`/`xml:lang`, and bilingual modes link a small stylesheet
 * that fades the source text. Files the OPF does not reference and XSLT stylesheets are dropped,
 * and scripts, event handlers and script URLs are stripped from every remaining markup file.
 * `mimetype` is written first and stored.
 */
export async function exportEpub(project: Project, mode: ExportMode, env: DomEnv): Promise<Uint8Array> {
  if (!EXPORT_MODES.includes(mode)) throw new Error(`Unknown export mode: ${mode}`);
  const files = readZip(project.sourceEpub);
  const pkg = parsePackage(files, env);
  prunePackageFiles(files, pkg);
  const xmlLangOnly = isEpub2Package(pkg);
  const segments = new Map(project.chapters.flatMap((c) => c.segments).map((s) => [s.id, s]));
  const cssPath = `${dirname(pkg.opfPath) ? `${dirname(pkg.opfPath)}/` : ''}${STYLESHEET_NAME}`;
  const bilingual = mode !== 'translation-only';
  const base = { env, mode, targetLang: project.settings.targetLang, xmlLangOnly };
  const sanitized = new Set<string>();

  for (const chapter of project.chapters) {
    if (!files.has(chapter.href)) continue;
    if (chapter.href === pkg.ncx?.path) continue;
    const markup = readText(files, chapter.href);
    const doc = parseXhtmlDocument(env, markup);
    const ctx: PlacementContext = { ...base, inline: chapter.href === pkg.nav?.path };
    let changed = false;
    for (const el of Array.from(doc.querySelectorAll(`[${SEGMENT_ATTR}]`))) {
      const segment = segments.get(el.getAttribute(SEGMENT_ATTR) ?? '');
      el.removeAttribute(SEGMENT_ATTR);
      if (!isDone(segment)) continue;
      placeTranslation(el, segment.translationHtml, ctx);
      changed = true;
    }
    if (changed && bilingual) ensureStylesheet(doc, relativeHref(chapter.href, cssPath));
    if (changed && mode === 'translation-only') setLang(doc.documentElement, ctx);
    stripActiveContent(doc);
    unmarkScripted(pkg, chapter.href, doc);
    sanitized.add(chapter.href);
    files.set(chapter.href, encodeUtf8(serializeXhtmlDocument(env, doc, exportDoctype(markup, xmlLangOnly))));
  }

  if (pkg.nav && files.has(pkg.nav.path)) repairNavDocument(files, pkg.nav.path, xmlLangOnly, env);
  if (pkg.ncx && files.has(pkg.ncx.path)) updateNcx(files, pkg, project, mode, env);
  stripActiveContentFromPackage(files, pkg, sanitized, env);
  if (bilingual) files.set(cssPath, encodeUtf8(STYLESHEET));
  files.set(pkg.opfPath, encodeUtf8(serializeXmlDocument(env, updateOpf(pkg, project, mode, bilingual ? cssPath : undefined))));
  return writeEpubZip(files);
}

/**
 * epubcheck rejects `aria-label` on `<nav>` in EPUB navigation documents (common in Gutenberg
 * books); the nav's heading or `epub:type` already labels it, so the attribute is dropped.
 */
function repairNavDocument(files: FileMap, path: string, epub2: boolean, env: DomEnv): void {
  const markup = readText(files, path);
  const doc = parseXhtmlDocument(env, markup);
  const labelled = byLocalName(doc, 'nav').filter((nav) => nav.hasAttribute('aria-label'));
  if (labelled.length === 0) return;
  for (const nav of labelled) nav.removeAttribute('aria-label');
  files.set(path, encodeUtf8(serializeXhtmlDocument(env, doc, exportDoctype(markup, epub2))));
}

/** NCX labels are text only: segment markers are applied directly, or labels are matched by source text. */
function updateNcx(files: FileMap, pkg: PackageInfo, project: Project, mode: ExportMode, env: DomEnv): void {
  const path = pkg.ncx?.path as string;
  const doc = parseXml(env, readText(files, path), path);
  const byId = new Map(project.chapters.flatMap((c) => c.segments).map((s) => [s.id, s]));
  const byText = new Map<string, Segment>();
  for (const s of project.chapters.flatMap((c) => c.segments)) if (isDone(s) && !byText.has(s.sourceText)) byText.set(s.sourceText, s);
  for (const text of byLocalName(doc, 'text')) {
    const marker = text.getAttribute(SEGMENT_ATTR);
    text.removeAttribute(SEGMENT_ATTR);
    const segment = marker ? byId.get(marker) : byText.get(textOf(text));
    if (isDone(segment)) text.textContent = textLabel(textOf(text), segment.translationHtml, { env, mode });
  }
  files.set(path, encodeUtf8(serializeXmlDocument(env, doc)));
}

function updateOpf(pkg: PackageInfo, project: Project, mode: ExportMode, cssPath: string | undefined): Document {
  const opf = pkg.opf;
  const metadata = firstByLocalName(opf, 'metadata');
  const languages = metadata ? byLocalName(metadata, 'language') : [];
  const first = languages[0];
  if (first?.parentNode) {
    const source = project.settings.sourceLang !== 'auto' ? project.settings.sourceLang : textOf(first);
    const target = project.settings.targetLang;
    const wanted = mode === 'translation-only' ? [target] : mode === 'bilingual' ? [source, target] : [target, source];
    for (const lang of [...new Set(wanted.filter(Boolean))]) {
      const el = first.cloneNode(false) as Element;
      el.removeAttribute('id');
      el.textContent = lang;
      first.parentNode.insertBefore(el, first);
    }
    for (const old of languages) old.parentNode?.removeChild(old);
  }
  for (const meta of metadata ? byLocalName(metadata, 'meta') : []) {
    if (meta.getAttribute('property') === 'dcterms:modified') meta.textContent = `${new Date().toISOString().slice(0, 19)}Z`;
  }
  const manifest = firstByLocalName(opf, 'manifest');
  const sample = manifest ? byLocalName(manifest, 'item')[0] : undefined;
  if (cssPath && manifest && sample && !byLocalName(manifest, 'item').some((i) => i.getAttribute('id') === 'epubtrans-css')) {
    const item = sample.cloneNode(false) as Element;
    for (const attr of Array.from(item.attributes)) item.removeAttribute(attr.name);
    item.setAttribute('id', 'epubtrans-css');
    item.setAttribute('href', relativeHref(pkg.opfPath, cssPath));
    item.setAttribute('media-type', 'text/css');
    manifest.appendChild(item);
  }
  return opf;
}
