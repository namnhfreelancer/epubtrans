import type { PackageInfo } from '../epub/package-document';
import { ATTRIBUTION_CLASS } from '../export-style/export-style-css';
import type { ExportMode, Project } from '../types';
import { encodeUtf8, escapeXml } from '../util/text-encoding';
import { stripXmlInvalidChars } from '../util/xml-chars';
import type { FileMap } from '../util/zip-archive';
import { dirname, relativeHref } from '../util/zip-path';
import { addManifestItem, appendSpineItem, freePackageId } from './manifest-items';

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
  ko: 'epubtrans에서 {model}(으)로 번역',
};

const MAX_MODEL_LENGTH = 100;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const PAGE_NAME = 'epubtrans-attribution';
const XHTML11_DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

/** The attribution sentence and its language: the target language when the table has it, else English. */
export function attributionText(targetLang: string, model: string): { lang: string; text: string } {
  const primary = targetLang.toLowerCase().split('-')[0] ?? '';
  const lang = PHRASES[primary] && LANGUAGE_TAG.test(targetLang) ? targetLang : 'en';
  const name = stripXmlInvalidChars(model).replace(/\s+/g, ' ').trim().slice(0, MAX_MODEL_LENGTH) || 'AI';
  return { lang, text: (lang === 'en' ? (PHRASES.en as string) : (PHRASES[primary] as string)).replace('{model}', () => name) };
}

/** True when an export of `project` in `mode` gets the attribution page: opted in, a translating mode, something translated. */
export function wantsAttribution(project: Project, mode: ExportMode): boolean {
  if (project.settings.attribution !== true || mode === 'original') return false;
  return project.chapters.some((c) => c.segments.some((s) => s.translationHtml && (s.status === 'translated' || s.status === 'reviewed')));
}

/**
 * Adds the attribution as a short colophon page at the end of the reading order: a new content document linked to
 * `epubtrans.css`, listed in the primary package's manifest and spine. No existing document is changed, which is the
 * least invasive valid choice (title pages differ from book to book). The model name is only ever written as text.
 */
export function addAttributionPage(files: FileMap, pkg: PackageInfo, project: Project, cssPath: string, epub2: boolean): void {
  const id = freePackageId(pkg, PAGE_NAME);
  const dir = dirname(pkg.opfPath);
  const path = `${dir ? `${dir}/` : ''}${id}.xhtml`;
  if (files.has(path)) return;
  const { lang, text } = attributionText(project.settings.targetLang, project.settings.model);
  const l = escapeXml(lang);
  const langAttrs = epub2 ? `xml:lang="${l}"` : `lang="${l}" xml:lang="${l}"`;
  const body = epub2
    ? `<div class="${ATTRIBUTION_CLASS}"><p>${escapeXml(text)}</p></div>`
    : `<section epub:type="colophon" class="${ATTRIBUTION_CLASS}"><p>${escapeXml(text)}</p></section>`;
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
  appendSpineItem(pkg, id);
}
