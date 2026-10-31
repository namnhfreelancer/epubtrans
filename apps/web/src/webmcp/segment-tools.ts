import { EXPORT_MODES, type ExportMode, exportEpub, type Project, retranslateSegment } from '@epubtrans/core';
import { safeFileName } from '../lib/download-file';
import { buildErrorIndex, locateSegment } from '../lib/error-index';
import { persistJobSegment, touchProject } from '../lib/project-store';
import { countSegments } from '../lib/segment-counts';
import { segmentErrorText } from '../lib/segment-error-text';
import { revisionOf, sameRevision } from '../lib/segment-revision';
import { currentProviderState } from '../lib/use-active-provider';
import { busyFailure, busyReason, findBook, isFailure, providerFailure, type ToolContext } from './tool-context';
import { BOOK_ID, CANCELLED, objectSchema, type ToolSpec } from './tool-definition';
import { clip, fail, fitList, ok, untrustedText } from './tool-result';

const MAX_ERRORS_PER_PAGE = 20;

/** Same file names as the Export tab; modes added to core later fall back to their own id. */
const exportFileSuffix = (mode: ExportMode): string => (mode === 'translation-only' ? 'translated' : mode);

/** Segments whose retranslation is in flight from a tool call, so the same segment is not sent twice at once. */
const retranslating = new Set<string>();

const EDITED_HINT = 'Ask the user to retranslate it in the reader if they want to replace their edit.';
const CHANGED_WHILE_RETRANSLATING = "segment changed while retranslating; kept the user's version";

/** Segment tools: failed segments, single-segment retranslation, EPUB export. */
export function segmentTools(ctx: ToolContext): ToolSpec[] {
  return [
    {
      name: 'list_errors',
      title: 'List failed segments',
      description:
        'Lists the segments of a book whose translation failed, in reading order, with the chapter, the failure reason and the start of the source text. Pages with offset and limit. Fix one with retranslate_segment, or all with start_translation.',
      inputSchema: objectSchema(
        {
          bookId: BOOK_ID,
          offset: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'Number of failed segments to skip (default 0).' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ERRORS_PER_PAGE, description: `Page size (default 10, at most ${MAX_ERRORS_PER_PAGE}).` },
        },
        ['bookId'],
      ),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      run: async (args) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const offset = args.optInt('offset') ?? 0;
        const limit = args.optInt('limit') ?? 10;
        const { locations } = buildErrorIndex(project.chapters);
        const items = locations.slice(offset, offset + limit).flatMap((loc) => {
          const chapter = project.chapters[loc.chapter];
          const segment = chapter?.segments[loc.segment];
          if (!chapter || !segment) return [];
          return [
            {
              segmentId: segment.id,
              chapter: loc.chapter + 1,
              chapterTitle: untrustedText(chapter.title, 60),
              error: untrustedText(segmentErrorText(segment.error) ?? 'unknown error', 160),
              source: untrustedText(segment.sourceHtml, 120),
            },
          ];
        });
        return fitList(items, (shown) => ok({ total: locations.length, offset, items: shown }));
      },
    },
    {
      name: 'retranslate_segment',
      title: 'Retranslate one segment',
      description:
        'Translates one segment again with the configured model (one small paid request), e.g. a failed one from list_errors, saves the result and shows it in the reader. The old translation is kept when it fails. Segments the user edited by hand are refused: ask the user to retranslate those in the reader. Unavailable while a translation or sample of the book runs.',
      inputSchema: objectSchema({ bookId: BOOK_ID, segmentId: { type: 'string', description: 'Segment id from list_errors.', maxLength: 200 } }, [
        'bookId',
        'segmentId',
      ]),
      annotations: { untrustedContentHint: true },
      run: async (args, signal) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const segmentId = args.string('segmentId');
        const location = locateSegment(project.chapters, segmentId);
        if (!location) return fail(`No segment with id "${segmentId.slice(0, 80)}" in this book.`, 'Use ids from list_errors.');
        const provider = currentProviderState();
        const notReady = providerFailure(provider);
        if (notReady) return notReady;
        // A running job (here or in another tab) would race the retranslation of the same segment.
        const busy = await busyReason(project.id, { ignoreGuide: true });
        if (busy) return busyFailure(busy);
        const key = `${project.id}\u0000${segmentId}`;
        if (retranslating.has(key)) return fail('This segment is already being retranslated.', 'Wait for the earlier call to finish.');
        // Hand edits are the user's own work: a retranslation would replace them for good, so only the user may.
        // Checked after the busy check, so an edit saved meanwhile counts.
        if (project.chapters[location.chapter]?.segments[location.segment]?.userEdited)
          return fail('The user edited this segment by hand, so tools do not retranslate it.', EDITED_HINT);
        retranslating.add(key);
        ctx.navigate({ name: 'book', id: project.id, tab: 'read', segment: segmentId });
        try {
          const { provider: chat, settings } = provider.prepare(project);
          const chapter = project.chapters[location.chapter];
          const live = chapter?.segments[location.segment];
          if (!chapter || !live) return fail(`No segment with id "${segmentId.slice(0, 80)}" in this book.`, 'Use ids from list_errors.');
          // Retranslate a detached copy: the live segment (and its stored state) stays whatever the user makes of it
          // meanwhile, and the result is committed only if nothing changed it since the request started.
          const started = revisionOf(live);
          const detached: Project = { ...project, chapters: [{ ...chapter, segments: [{ ...live }] }] };
          const result = await retranslateSegment(detached, segmentId, chat, settings, signal);
          if (live.userEdited || !sameRevision(revisionOf(live), started)) return fail(CHANGED_WHILE_RETRANSLATING, EDITED_HINT);
          // Same synchronous apply-then-compare-and-set as translation runs; a conflicting stored change reverts it.
          const { translationHtml, status, error } = result;
          Object.assign(live, { translationHtml, status });
          if (error === undefined) delete live.error;
          else live.error = error;
          project.updatedAt = detached.updatedAt;
          touchProject(project.id);
          if (!(await persistJobSegment(project, live, new Map([[segmentId, started]])))) return fail(CHANGED_WHILE_RETRANSLATING, EDITED_HINT);
          return ok({ segmentId, status: live.status, translation: untrustedText(live.translationHtml, 300) });
        } catch (err) {
          if (signal?.aborted) return CANCELLED();
          const message = err instanceof Error ? err.message : String(err);
          return fail(`Retranslation failed: ${untrustedText(segmentErrorText(message) ?? message, 300)}`);
        } finally {
          retranslating.delete(key);
        }
      },
    },
    {
      name: 'export_epub',
      title: 'Export the EPUB',
      description:
        'Builds the translated EPUB of a book in the chosen layout and downloads it in the browser. Untranslated segments keep their source text. Layouts include bilingual (source, then translation), bilingual-translation-first and translation-only (no source text).',
      inputSchema: objectSchema({ bookId: BOOK_ID, mode: { type: 'string', enum: [...EXPORT_MODES], description: 'Layout of the exported book.' } }, [
        'bookId',
        'mode',
      ]),
      annotations: { untrustedContentHint: true },
      run: async (args) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const mode = EXPORT_MODES.find((m) => m === args.string('mode'));
        if (!mode) return fail(`Unknown mode. Use one of: ${EXPORT_MODES.join(', ')}.`);
        let bytes: Uint8Array;
        try {
          bytes = await exportEpub(project, mode, ctx.domEnv());
        } catch (err) {
          return fail(`Export failed: ${clip(err instanceof Error ? err.message : String(err), 300)}`);
        }
        const fileName = `${safeFileName(project.title)}.${project.settings.targetLang}.${exportFileSuffix(mode)}.epub`;
        ctx.navigate({ name: 'book', id: project.id, tab: 'export' });
        ctx.download(bytes, fileName, 'application/epub+zip');
        const counts = countSegments(project);
        return ok({ fileName: untrustedText(fileName, 160), bytes: bytes.byteLength, untranslated: counts.pending + counts.error });
      },
    },
  ];
}
