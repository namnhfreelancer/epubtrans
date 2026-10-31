import { SEGMENT_ATTR } from '../dom/fragment-markup';
import { ensureStylesheet, exportDoctype, parseXhtmlDocument, serializeXhtmlDocument, serializeXmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName, parseXml, textOf } from '../dom/xml-dom-helpers';
import { isEpub2Package, type PackageInfo, parseOtherRenditions, parsePackage, readContainerLinks, readRootfiles, readText } from '../epub/package-document';
import type { FontFileLoader } from '../export-style/embedded-fonts';
import { embeddedFontsFor, exportStyleCss, stylesTranslation } from '../export-style/export-style-css';
import { validateExportStyle } from '../export-style/export-style-validation';
import type { DomEnv, ExportMode, Project, Segment } from '../types';
import { encodeUtf8 } from '../util/text-encoding';
import { type FileMap, readZip, writeEpubZip } from '../util/zip-archive';
import { dirname, relativeHref } from '../util/zip-path';
import { addAttributionPage, wantsAttribution } from './attribution-page';
import { loadEmbeddedFontFiles, packageEmbeddedFonts } from './embedded-font-package';
import { applyExportIdentifier } from './export-identifier';
import { addManifestItem } from './manifest-items';
import { markPreviewSegment } from './preview-markers';
import { prunePackageFiles } from './prune-package-files';
import { addClass, type PlacementContext, placeTranslation, setLang, TRANSLATION_CLASS, textLabel } from './segment-placement';
import { stripActiveContent, stripActiveContentFromPackage, unmarkScripted } from './strip-active-content';
import { applyWordHints, HINT_PARAGRAPH_CLASS, planWordHintExport } from './word-hint-markup';
import { cssStylesheetInstructions } from './xml-prolog';

export const EXPORT_MODES: ExportMode[] = ['bilingual', 'bilingual-translation-first', 'translation-only', 'original'];
/** Modes that keep the source text, so they can carry Word Wise hints. */
export const HINT_EXPORT_MODES: ExportMode[] = ['bilingual', 'bilingual-translation-first', 'original'];

const STYLESHEET_NAME = 'epubtrans.css';
const STYLESHEET_ID = 'epubtrans-css';

/** Options for {@link exportEpub}. */
export interface ExportOptions {
  /**
   * Preview builds only, never for downloads: segment blocks keep their `data-et-id` marker, and blocks of failed
   * or untranslated segments get the classes `et-error` / `et-pending`. The default (off) output is unchanged.
   */
  preview?: boolean;
  /**
   * Reads the bundled font files a style embeds (web: fetched from the app's origin; CLI: read from its binary). Needed
   * only when the book's export style picks a bundled font; without it such an export fails with a clear error.
   */
  loadFontFile?: FontFileLoader;
}

const isDone = (s: Segment | undefined): s is Segment & { translationHtml: string } =>
  !!s?.translationHtml && (s.status === 'translated' || s.status === 'reviewed');

/**
 * Builds the output EPUB. Untranslated segments keep their source text. Segment markers are
 * removed, translated blocks get `lang`/`xml:lang`, and bilingual modes link a small stylesheet
 * that fades the source text. `original` keeps the source text only. When Word Wise hints are enabled
 * and generated, every mode except `translation-only` writes them into the source text (ruby, or inline
 * text for the inline style and for EPUB 2) and links the stylesheet. Translations apply to the primary rendition; other renditions of a
 * multi-rendition book are kept (listing the stylesheet when they share a translated document).
 * Files no package document references and XSLT stylesheets are dropped, and scripts, event
 * handlers and script URLs are stripped from every remaining markup file, package documents
 * included. `mimetype` is written first and stored. `options.preview` keeps segment markers for the in-app preview.
 *
 * The book's `exportStyle` (validated again here) only changes the generated `epubtrans.css`; bundled fonts it picks
 * are packaged with their license (`options.loadFontFile`). The export gets its own `dc:identifier` unless fonts are
 * obfuscated (see `export-identifier.ts`), and an opted-in book ends with a short attribution page.
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
  const bilingual = mode === 'bilingual' || mode === 'bilingual-translation-first';
  const base = { env, mode, targetLang: project.settings.targetLang, xmlLangOnly };
  const hints = planWordHintExport(project, mode, xmlLangOnly);
  // Validated again here (also normalizing colors): only clean values may reach the stylesheet, whatever built the project.
  const style = project.settings.exportStyle === undefined ? undefined : validateExportStyle(project.settings.exportStyle);
  // Translation-only blocks carry no class by default; a style for the translation needs one to select them.
  const markTranslationOnly = mode === 'translation-only' && stylesTranslation(style);
  // Loaded before any work, so a missing font fails the export early.
  const fonts = await loadEmbeddedFontFiles(embeddedFontsFor(style, mode), options.loadFontFile);
  const sanitized = new Set<string>();
  const linked = new Set<string>();

  for (const chapter of project.chapters) {
    if (!files.has(chapter.href)) continue;
    if (chapter.href === pkg.ncx?.path) continue;
    const markup = readText(files, chapter.href);
    const doc = parseXhtmlDocument(env, markup);
    const ctx: PlacementContext = { ...base, inline: chapter.href === pkg.nav?.path };
    let changed = false;
    let hinted = false;
    for (const el of Array.from(doc.querySelectorAll(`[${SEGMENT_ATTR}]`))) {
      const id = el.getAttribute(SEGMENT_ATTR) ?? '';
      const segment = segments.get(id);
      if (options.preview) markPreviewSegment(el, segment, isDone(segment));
      else el.removeAttribute(SEGMENT_ATTR);
      // Hints go into the source text before the translation is placed; never into the table of contents.
      const placements = hints && !ctx.inline ? hints.placements.get(id) : undefined;
      const hintCount = hints && placements ? applyWordHints(el, placements, hints, xmlLangOnly) : 0;
      if (hintCount > 0) hinted = true;
      if (isDone(segment) && mode !== 'original') {
        placeTranslation(el, segment.translationHtml, ctx);
        if (markTranslationOnly) addClass(el, TRANSLATION_CLASS);
        changed = true;
      }
      if (hintCount > 0 && hints?.style === 'ruby') addClass(el, HINT_PARAGRAPH_CLASS);
    }
    if ((changed && (bilingual || markTranslationOnly)) || hinted) {
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
  // Added after sanitizing: the attribution page and the font files are generated here, never taken from the book.
  const attribution = wantsAttribution(project, mode);
  if (attribution) addAttributionPage(files, pkg, project, cssPath, env);
  const withCss = bilingual || linked.size > 0 || attribution;
  updateOpf(pkg, project, mode, withCss ? cssPath : undefined);
  // Other renditions that share a document linking the stylesheet list it, and the fonts it loads, too.
  const sharing = renditions.slice(1).filter((other) => other.manifest.some((m) => linked.has(m.path)));
  for (const other of sharing) addManifestItem(other, STYLESHEET_ID, cssPath, 'text/css');
  if (withCss) {
    files.set(cssPath, encodeUtf8(exportStyleCss(style, { fonts: fonts.fonts, attribution })));
    packageEmbeddedFonts(files, [pkg, ...sharing], cssPath, fonts, xmlLangOnly);
  }
  applyExportIdentifier(files, renditions, project, mode, env);
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
    const wanted = mode === 'translation-only' ? [target] : mode === 'original' ? [source] : mode === 'bilingual' ? [source, target] : [target, source];
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
  if (cssPath) addManifestItem(pkg, STYLESHEET_ID, cssPath, 'text/css');
}
