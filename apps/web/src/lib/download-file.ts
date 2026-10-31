import type { ExportMode, Project } from '@epubtrans/core';

/** Saves bytes as a file through a temporary object URL. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start reading the blob asynchronously after the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** File-system safe name derived from a book title. */
export function safeFileName(title: string, fallback = 'book'): string {
  const printable = Array.from(title, (ch) => ((ch.codePointAt(0) ?? 0) < 0x20 ? ' ' : ch)).join('');
  const name = printable
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return name || fallback;
}

const EXPORT_FILE_SUFFIX: Record<ExportMode, string> = {
  bilingual: 'bilingual',
  'bilingual-translation-first': 'bilingual-translation-first',
  'translation-only': 'translated',
  original: 'original',
};

/** File name of an exported EPUB: the original-text export is named after the source language, the others after the target. */
export function exportFileName(project: Project, mode: ExportMode): string {
  const lang = mode === 'original' ? project.settings.sourceLang.replace('auto', 'source') : project.settings.targetLang;
  return `${safeFileName(project.title)}.${lang}.${EXPORT_FILE_SUFFIX[mode]}.epub`;
}
