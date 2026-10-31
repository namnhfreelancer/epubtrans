import { SEGMENT_ATTR } from '../dom/fragment-markup';
import { ensureStylesheet, exportDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName, parseXml, textOf } from '../dom/xml-dom-helpers';
import { isEpub2Package, type PackageInfo, parseOtherRenditions, parsePackage, readContainerLinks, readRootfiles, readText } from '../epub/package-document';
import type { DomEnv, ExportMode, Project, Segment } from '../types';
import { encodeUtf8 } from '../util/text-encoding';
import { type FileMap, readZip, writeEpubZip } from '../util/zip-archive';
import { dirname, relativeHref } from '../util/zip-path';
import { markPreviewSegment } from './preview-markers';
import { prunePackageFiles } from './prune-package-files';
import { type PlacementContext, placeTranslation, SOURCE_CLASS, setLang, textLabel } from './segment-placement';
import { stripActiveContent, stripActiveContentFromPackage, unmarkScripted } from './strip-active-content';
import { cssStylesheetInstructions } from './xml-prolog';

export const EXPORT_MODES: ExportMode[] = ['bilingual', 'bilingual-translation-first', 'translation-only'];

const STYLESHEET = `/* epubtrans: bilingual layout */\n.${SOURCE_CLASS} { opacity: 0.55; }\n`;
const STYLESHEET_NAME = 'epubtrans.css';

/** Options for {@link exportEpub}. */
export interface ExportOptions {
  /**
   * Preview builds only, never for downloads: segment blocks keep their `data-et-id` marker, and blocks of failed
   * or untranslated segments get the classes `et-error` / `et-pending`. The default (off) output is unchanged.
   */
  preview?: boolean;
}

const isDone = (s: Segment | undefined): s is Segment & { translationHtml: string } =>
  !!s?.translationHtml && (s.status === 'translated' || s.status === 'reviewed');

/**
 * Builds the output EPUB. Untranslated segments keep their source text. Segment markers are
 * removed, translated blocks get `lang`/`xml:lang`, and bilingual modes link a small stylesheet
 * that fades the source text. Translations apply to the primary rendition; other renditions of a
 * multi-rendition book are kept (listing the stylesheet when they share a translated document).
 * Files no package document references and XSLT stylesheets are dropped, and scripts, event
 * handlers and script URLs are stripped from every remaining markup file, package documents
 * included. `mimetype` is written first and stored. `options.preview` keeps segment markers for the in-app preview.
 */
export async function exportEpub(project: Project, mode: ExportMode, env: DomEnv, options: ExportOptions = {}): Promise<Uint8Array> {
  if (!EXPORT_MODES.includes(mode)) throw new Error(`Unknown export mode: ${mode}`);
  const files = readZip(project.sourceEpub);
  const pkg = parsePackage(files, env);
  const renditions = [pkg, ...parseOtherRenditions(files, env, pkg)];
  const containerTargets = [...readRootfiles(files, env).map((r) => r.path), ...readContainerLinks(files, env)];
  prunePackageFiles(files, renditions, containerTargets);
  const xmlLangOnly = isEpub2Package(pkg);
  const segments = new Map(project.chapters.flatMap((c) => c.segments).map((s) => [s.id, s]));
  const cssPath = `${dirname(pkg.opfPath) ? `${dirname(pkg.opfPath)}/` : ''}${STYLESHEET_NAME}`;
  const bilingual = mode !== 'translation-only';
  const base = { env, mode, targetLang: project.settings.targetLang, xmlLangOnly };
  const sanitized = new Set<string>();
  const linked = new Set<string>();

  for (const chapter of project.chapters) {
    if (!files.has(chapter.href)) continue;
    if (chapter.href === pkg.ncx?.path) continue;
    const markup = readText(files, chapter.href);
    const doc = parseXhtmlDocument(env, markup);
    const ctx: PlacementContext = { ...base, inline: chapter.href === pkg.nav?.path };
    let changed = false;
    for (const el of Array.from(doc.querySelectorAll(`[${SEGMENT_ATTR}]`))) {
      const segment = segments.get(el.getAttribute(SEGMENT_ATTR) ?? '');
      if (options.preview) markPreviewSegment(el, segment, isDone(segment));
      else el.removeAttribute(SEGMENT_ATTR);
      if (!isDone(segment)) continue;
      placeTranslation(el, segment.translationHtml, ctx);
      changed = true;
    }
    if (changed && bilingual) {
      ensureStylesheet(doc, relativeHref(chapter.href, cssPath));
      linked.add(chapter.href);
    }
    if (changed && mode === 'translation-only') setLang(doc.documentElement, ctx);
    stripActiveContent(doc);
    for (const r of renditions) unmarkScripted(r, chapter.href, doc);
    sanitized.add(chapter.href);
    files.set(chapter.href, encodeUtf8(serializeXhtmlDocument(env, doc, exportDoctype(markup, xmlLangOnly), cssStylesheetInstructions(markup))));
  }

  if (pkg.nav && files.has(pkg.nav.path)) repairNavDocument(files, pkg.nav.path, xmlLangOnly, env);
  if (pkg.ncx && files.has(pkg.ncx.path)) updateNcx(files, pkg, project, mode, env);
  stripActiveContentFromPackage(files, renditions, sanitized, env);
  if (bilingual) files.set(cssPath, encodeUtf8(STYLESHEET));
  updateOpf(pkg, project, mode, bilingual ? cssPath : undefined);
  for (const other of renditions.slice(1)) {
    if (other.manifest.some((m) => linked.has(m.path))) addStylesheetItem(other, cssPath);
  }
  for (const { opfPath, opf } of renditions) {
    stripActiveContent(opf);
    files.set(opfPath, encodeUtf8(serializeXmlDocument(env, opf)));
  }
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
  files.set(path, encodeUtf8(serializeXhtmlDocument(env, doc, exportDoctype(markup, epub2), cssStylesheetInstructions(markup))));
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

function updateOpf(pkg: PackageInfo, project: Project, mode: ExportMode, cssPath: string | undefined): void {
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
  if (cssPath) addStylesheetItem(pkg, cssPath);
}

/** Declares the bilingual stylesheet in a package's manifest (once). */
function addStylesheetItem(pkg: PackageInfo, cssPath: string): void {
  const manifest = firstByLocalName(pkg.opf, 'manifest');
  const sample = manifest ? byLocalName(manifest, 'item')[0] : undefined;
  if (manifest && sample && !byLocalName(manifest, 'item').some((i) => i.getAttribute('id') === 'epubtrans-css')) {
    const item = sample.cloneNode(false) as Element;
    for (const attr of Array.from(item.attributes)) item.removeAttribute(attr.name);
    item.setAttribute('id', 'epubtrans-css');
    item.setAttribute('href', relativeHref(pkg.opfPath, cssPath));
    item.setAttribute('media-type', 'text/css');
    manifest.appendChild(item);
  }
}
