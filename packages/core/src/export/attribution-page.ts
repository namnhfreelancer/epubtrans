import { parseXhtmlDocument } from '../dom/xhtml-document';
import { byLocalName, firstByLocalName, textOf } from '../dom/xml-dom-helpers';
import { isEpub2Package, type PackageInfo, readText } from '../epub/package-document';
import { ATTRIBUTION_CLASS } from '../export-style/export-style-css';
import type { DomEnv, ExportMode, Project } from '../types';
import { encodeUtf8, escapeXml } from '../util/text-encoding';
import { stripXmlInvalidChars } from '../util/xml-chars';
import type { FileMap } from '../util/zip-archive';
import { dirname, relativeHref } from '../util/zip-path';
import { addManifestItem, appendSpineItem, freePackageId, removePackageItem } from './manifest-items';

/** "Translated with <model> by epubtrans" in the languages where a short phrase is unambiguous; others use English. */
const PHRASES: Record<string, string> = {
  en: 'Translated with {model} by epubtrans',
  vi: 'Dịch bằng {model} với epubtrans',
  fr: 'Traduit avec {model} par epubtrans',
  de: 'Übersetzt mit {model} von epubtrans',
  es: 'Traducido con {model} por epubtrans',
  it: 'Tradotto con {model} da epubtrans',
  pt: 'Traduzido com {model} por epubtrans',
  nl: 'Vertaald met {model} door epubtrans',
  ru: 'Переведено с помощью {model} в epubtrans',
  ja: '{model} を使用して epubtrans で翻訳',
  zh: '由 epubtrans 使用 {model} 翻译',
  'zh-hant': '由 epubtrans 使用 {model} 翻譯',
  ko: 'epubtrans에서 {model}(으)로 번역',
};

const MAX_MODEL_LENGTH = 100;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const PAGE_NAME = 'epubtrans-attribution';
/**
 * `id` of the page's content element, together with the `et-attr` class: marks a colophon epubtrans generated, so
 * importing an epubtrans export does not translate it again and exporting it again replaces it instead of adding one.
 */
const PAGE_MARKER_ID = 'epubtrans-attribution';
const XHTML11_DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

/** The phrase table key of a language tag: its primary subtag, or `zh-hant` for Traditional Chinese (script or region). */
function phraseKey(tag: string): string {
  const subtags = tag.toLowerCase().split('-');
  const primary = subtags[0] ?? '';
  if (primary !== 'zh' || subtags.includes('hans')) return primary;
  return subtags.includes('hant') || subtags.some((s) => s === 'tw' || s === 'hk' || s === 'mo') ? 'zh-hant' : primary;
}

/** The attribution sentence and its language: the target language when the table has it, else English. */
export function attributionText(targetLang: string, model: string): { lang: string; text: string } {
  const key = phraseKey(targetLang);
  const lang = PHRASES[key] && LANGUAGE_TAG.test(targetLang) ? targetLang : 'en';
  const name = stripXmlInvalidChars(model).replace(/\s+/g, ' ').trim().slice(0, MAX_MODEL_LENGTH) || 'AI';
  return { lang, text: (lang === 'en' ? (PHRASES.en as string) : (PHRASES[key] as string)).replace('{model}', () => name) };
}

/** True for a colophon page epubtrans generated (an earlier export's attribution page). */
export function isAttributionDocument(doc: Document): boolean {
  return Array.from(doc.querySelectorAll('[id]')).some(
    (el) => el.getAttribute('id') === PAGE_MARKER_ID && (el.getAttribute('class') ?? '').split(/\s+/).includes(ATTRIBUTION_CLASS),
  );
}

/**
 * Removes the attribution pages of earlier epubtrans exports from the package (spine, manifest and file), so a book
 * that is itself an epubtrans export ends with one attribution page, not one per export.
 */
export function removeEarlierAttributionPages(files: FileMap, pkg: PackageInfo, env: DomEnv): void {
  for (const item of [...pkg.spine]) {
    if (!files.has(item.path)) continue;
    const markup = readText(files, item.path);
    if (!markup.includes(PAGE_MARKER_ID) || !isAttributionDocument(parseXhtmlDocument(env, markup))) continue;
    removePackageItem(pkg, item.id);
    files.delete(item.path);
  }
}

/** True when the package lays out every document as fixed pages (EPUB 3 fixed layout), unless a spine item overrides it. */
function isPrePaginated(pkg: PackageInfo): boolean {
  if (isEpub2Package(pkg)) return false;
  const metadata = firstByLocalName(pkg.opf, 'metadata');
  const layout = metadata
    ? byLocalName(metadata, 'meta').find((m) => m.getAttribute('property') === 'rendition:layout' && !m.hasAttribute('refines'))
    : undefined;
  return textOf(layout).trim() === 'pre-paginated';
}

/** True when an export of `project` in `mode` gets the attribution page: opted in, a translating mode, something translated. */
export function wantsAttribution(project: Project, mode: ExportMode): boolean {
  if (project.settings.attribution !== true || mode === 'original') return false;
  return project.chapters.some((c) => c.segments.some((s) => s.translationHtml && (s.status === 'translated' || s.status === 'reviewed')));
}

/**
 * Adds the attribution as a short colophon page at the end of the reading order: a new content document linked to
 * `epubtrans.css`, listed in the primary package's manifest and spine. No existing document is changed, which is the
 * least invasive valid choice (title pages differ from book to book); an earlier export's attribution page is replaced.
 * In a fixed-layout book the page is reflowable (`rendition:layout-reflowable` on its spine entry): a pre-paginated
 * document would need a viewport, and a short text page reads better reflowed. The model name is only ever text.
 */
export function addAttributionPage(files: FileMap, pkg: PackageInfo, project: Project, cssPath: string, env: DomEnv): void {
  const epub2 = isEpub2Package(pkg);
  removeEarlierAttributionPages(files, pkg, env);
  const id = freePackageId(pkg, PAGE_NAME);
  const dir = dirname(pkg.opfPath);
  const path = `${dir ? `${dir}/` : ''}${id}.xhtml`;
  if (files.has(path)) return;
  const { lang, text } = attributionText(project.settings.targetLang, project.settings.model);
  const l = escapeXml(lang);
  const langAttrs = epub2 ? `xml:lang="${l}"` : `lang="${l}" xml:lang="${l}"`;
  const body = epub2
    ? `<div id="${PAGE_MARKER_ID}" class="${ATTRIBUTION_CLASS}"><p>${escapeXml(text)}</p></div>`
    : `<section epub:type="colophon" id="${PAGE_MARKER_ID}" class="${ATTRIBUTION_CLASS}"><p>${escapeXml(text)}</p></section>`;
  const markup = [
    '<?xml version="1.0" encoding="utf-8"?>',
    epub2 ? XHTML11_DOCTYPE : '<!DOCTYPE html>',
    `<html xmlns="http://www.w3.org/1999/xhtml"${epub2 ? '' : ' xmlns:epub="http://www.idpf.org/2007/ops"'} ${langAttrs}>`,
    `<head><title>epubtrans</title><link rel="stylesheet" type="text/css" href="${escapeXml(relativeHref(path, cssPath))}"/></head>`,
    `<body>${body}</body>`,
    '</html>',
    '',
  ].join('\n');
  files.set(path, encodeUtf8(markup));
  addManifestItem(pkg, id, path, 'application/xhtml+xml');
  appendSpineItem(pkg, id, isPrePaginated(pkg) ? 'rendition:layout-reflowable' : undefined);
}
