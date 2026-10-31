import type { Project, SampleSelection } from '@epubtrans/core';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Segment markup as plain text: tags dropped, the common entities decoded, whitespace collapsed. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith('#')) {
        const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text report of a sample: per passage the chapter title and every segment as a source/translation pair. */
export function formatSampleReport(project: Project, selection: SampleSelection): string {
  const segments = new Map(project.chapters.flatMap((c) => c.segments.map((s) => [s.id, s] as const)));
  const lines: string[] = [];
  selection.passages.forEach((passage, index) => {
    lines.push(`=== Passage ${index + 1}/${selection.passages.length}: ${passage.chapterTitle} ===`);
    for (const id of passage.segmentIds) {
      const segment = segments.get(id);
      if (!segment) continue;
      lines.push('', `[${id}] source:`, htmlToPlainText(segment.sourceHtml));
      lines.push(
        'translation:',
        segment.translationHtml !== undefined && segment.status !== 'error'
          ? htmlToPlainText(segment.translationHtml)
          : `(not translated${segment.error ? `: ${segment.error}` : ''})`,
      );
    }
    lines.push('');
  });
  return `${lines.join('\n')}\n`;
}
