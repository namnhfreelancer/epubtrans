import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { safeFileName } from '../src/lib/download-file';
import { formatDuration, parseOptionalPrice } from '../src/lib/format';
import { parseHash, routeHref } from '../src/lib/hash-route';
import { BookImportError, classifyImportError } from '../src/lib/import-book-file';
import { normalizeLanguageTag } from '../src/lib/languages';
import { countChapterSegments, remainingWork } from '../src/lib/segment-counts';
import { estimateRemainingMs } from '../src/lib/translation-jobs';

describe('hash routes', () => {
  it('parses and builds routes symmetrically', () => {
    expect(parseHash('')).toEqual({ name: 'library' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/book/abc/read')).toEqual({ name: 'book', id: 'abc', tab: 'read' });
    expect(parseHash('#/book/abc/bogus')).toEqual({ name: 'book', id: 'abc', tab: 'setup' });
    const route = { name: 'book', id: 'a b/c', tab: 'export' } as const;
    expect(parseHash(routeHref(route))).toEqual(route);
  });
});

describe('language tags', () => {
  it('canonicalizes valid tags and rejects invalid ones', () => {
    expect(normalizeLanguageTag('pt-br')).toBe('pt-BR');
    expect(normalizeLanguageTag('vi — Vietnamese')).toBe('vi');
    expect(normalizeLanguageTag('zh-hant')).toBe('zh-Hant');
    expect(normalizeLanguageTag('not a tag!')).toBeUndefined();
    expect(normalizeLanguageTag('')).toBeUndefined();
    expect(normalizeLanguageTag('x')).toBeUndefined();
  });
});

describe('import error classification', () => {
  it('maps core messages to friendly categories', () => {
    expect(classifyImportError(new Error('This book is DRM-protected; only DRM-free books are supported'), false).kind).toBe('drm');
    expect(classifyImportError(new Error('Unsupported file format: a.pdf. Supported: EPUB, MOBI, AZW3, FB2'), false).kind).toBe('unsupported');
    expect(classifyImportError(new Error('No translatable text found in this book'), false).kind).toBe('empty');
    expect(classifyImportError(new Error('Invalid project file: x'), true).kind).toBe('project');
    expect(classifyImportError(new Error('boom'), false).kind).toBe('generic');
    const tooLarge = new BookImportError('tooLarge', 'big');
    expect(classifyImportError(tooLarge, false)).toBe(tooLarge);
  });
});

describe('progress helpers', () => {
  const chapters = [
    {
      href: 'a',
      title: 'A',
      segments: [
        { id: '1', sourceHtml: '', sourceText: '', status: 'pending' as const },
        { id: '2', sourceHtml: '', sourceText: '', status: 'translated' as const },
        { id: '3', sourceHtml: '', sourceText: '', status: 'reviewed' as const },
        { id: '4', sourceHtml: '', sourceText: '', status: 'error' as const },
      ],
    },
  ];

  it('counts statuses and remaining work per pass mode', () => {
    const counts = countChapterSegments(chapters);
    expect(counts).toEqual({ total: 4, done: 2, pending: 1, translated: 1, reviewed: 1, error: 1, reviewable: 1 });
    expect(remainingWork(counts, false)).toBe(2);
    expect(remainingWork(counts, true)).toBe(3);
  });

  it('does not count hand-edited drafts as two-pass work, since core never reviews them', () => {
    const segments = [
      { id: '1', sourceHtml: '', sourceText: '', status: 'translated' as const, translationHtml: 'mine', userEdited: true },
      { id: '2', sourceHtml: '', sourceText: '', status: 'translated' as const, translationHtml: 'draft' },
      // A flag without a translation protects nothing (core translates it), so it still counts.
      { id: '3', sourceHtml: '', sourceText: '', status: 'translated' as const, userEdited: true },
    ];
    const counts = countChapterSegments([{ href: 'a', title: 'A', segments }]);
    expect(counts).toMatchObject({ translated: 3, reviewable: 2 });
    expect(remainingWork(counts, true)).toBe(2);
    expect(remainingWork(countChapterSegments([{ href: 'a', title: 'A', segments: segments.slice(0, 1) }]), true)).toBe(0);
  });

  it('estimates remaining time from the observed rate', () => {
    expect(estimateRemainingMs({ done: 0, total: 10, phaseStartedAt: 0 }, 1000)).toBeUndefined();
    expect(estimateRemainingMs({ done: 5, total: 10, phaseStartedAt: 0 }, 10_000)).toBe(10_000);
    expect(estimateRemainingMs({ done: 10, total: 10, phaseStartedAt: 0 }, 10_000)).toBeUndefined();
  });

  it('formats durations and parses prices', () => {
    expect(formatDuration(45_000, 'en')).toMatch(/45/);
    expect(formatDuration(3_900_000, 'en')).toMatch(/1.*5/);
    expect(parseOptionalPrice('')).toBeUndefined();
    expect(parseOptionalPrice('-1')).toBeUndefined();
    expect(parseOptionalPrice('0,5')).toBe(0.5);
    expect(parseOptionalPrice('3')).toBe(3);
  });

  it('builds file-system safe names', () => {
    expect(safeFileName('A: Modest/Proposal?')).toBe('A Modest Proposal');
    expect(safeFileName('   ')).toBe('book');
  });
});
