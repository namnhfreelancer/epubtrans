import type { Project } from '@epubtrans/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { buildErrorIndex, errorOrdinal, findAdjacentError, locateSegment, type SegmentLocation, type StepDirection } from '../../lib/error-index';
import { navigate, routeHref } from '../../lib/hash-route';
import { useHintsRunning } from '../../lib/hint-jobs';
import { useSampleRunning } from '../../lib/sample-jobs';
import { countChapterSegments } from '../../lib/segment-counts';
import { pauseJob, useJob } from '../../lib/translation-jobs';
import { useActiveProvider } from '../../lib/use-active-provider';
import { useStartTranslation } from '../../lib/use-start-translation';
import { ReaderChapterList } from './reader-chapter-list';
import { ReaderErrorControls } from './reader-error-controls';
import { type ReaderMode, SegmentRow } from './segment-row';

const FLASH_MS = 2000;
/** Keys that step through errors; chosen because they type nothing in the reader and are ignored while editing. */
const SHORTCUTS: Record<string, StepDirection> = { '[': -1, ']': 1 };

const isEditable = (target: EventTarget | null): boolean => target instanceof Element && target.closest('input, textarea, select, [contenteditable]') !== null;

/** Chapter navigation plus source/translation pairs of the selected chapter, with error highlighting and navigation. */
export function ReaderPanel({ project, version, segment }: { project: Project; version: number; segment?: string }) {
  const { t } = useI18n();
  const provider = useActiveProvider();
  const job = useJob(project.id);
  const sampleRunning = useSampleRunning(project.id);
  const hintsRunning = useHintsRunning(project.id);
  const { start: retryAll, error: retryError, busyElsewhere } = useStartTranslation(project, provider);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      project.chapters.findIndex((c) => c.segments.some((s) => s.status === 'pending' || s.status === 'error')),
    ),
  );
  const [mode, setMode] = useState<ReaderMode>('side');
  const [onlyErrors, setOnlyErrors] = useState(false);
  /** The segment last jumped to; the next/previous error is searched from here. */
  const [cursor, setCursor] = useState<SegmentLocation>();
  /** A pending "scroll to and focus this segment" request; `n` makes repeated jumps to the same segment distinct. */
  const [reveal, setReveal] = useState<{ id: string; n: number }>();
  const [flashId, setFlashId] = useState<string>();
  const revealCount = useRef(0);
  const contentRef = useRef<HTMLElement>(null);
  const chapter = project.chapters[index] ?? project.chapters[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const progress = useMemo(() => project.chapters.map((c) => countChapterSegments([c])), [project, version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const errors = useMemo(() => buildErrorIndex(project.chapters), [project, version]);
  const retrying = job.status === 'running' || job.status === 'pausing';
  // Core has no "failed segments only" run: a start also translates every untranslated segment (and, in two-pass
  // mode, reviews every draft not edited by hand). With such work outstanding the button must not start a paid book
  // run by itself.
  const unfinished = progress.reduce((sum, c) => sum + c.pending + (project.settings.twoPass ? c.reviewable : 0), 0);
  const resumeInstead = unfinished > 0;

  const jumpTo = (target: SegmentLocation) => {
    setIndex(target.chapter);
    setCursor(target);
    setReveal({ id: target.id, n: ++revealCount.current });
    // Keep the URL shareable and reload-safe without stacking a history entry per jump.
    history.replaceState(null, '', routeHref({ name: 'book', id: project.id, tab: 'read', segment: target.id }));
  };

  const selectChapter = (i: number) => {
    setIndex(i);
    setCursor(undefined);
    history.replaceState(null, '', routeHref({ name: 'book', id: project.id, tab: 'read' }));
  };

  const searchFrom = cursor ?? { chapter: index, segment: -1 };
  const adjacent: Record<StepDirection, SegmentLocation | undefined> = {
    '-1': findAdjacentError(errors, searchFrom, -1),
    1: findAdjacentError(errors, searchFrom, 1),
  };
  const step = (direction: StepDirection) => {
    const target = adjacent[direction];
    if (target) jumpTo(target);
  };

  // Deep link (`#/book/<id>/read/<segment>`): open the chapter holding the segment and reveal it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a changed link should re-run; jumpTo is rebuilt every render.
  useEffect(() => {
    const target = segment ? locateSegment(project.chapters, segment) : undefined;
    if (target) jumpTo(target);
  }, [segment, project]);

  // After the target chapter has rendered: centre the segment, move focus to it and flash it briefly.
  useEffect(() => {
    if (!reveal) return;
    const row = contentRef.current?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(reveal.id)}"]`);
    if (!row) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    row.focus({ preventScroll: true });
    setFlashId(reveal.id);
    const timer = setTimeout(() => setFlashId(undefined), FLASH_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  // `[` / `]` step through errors, except while typing in a field (the segment editor, selects, ...) or with a modifier held.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const direction = SHORTCUTS[e.key];
      if (!direction || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      e.preventDefault();
      stepRef.current(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!chapter) return <p className="text-sm text-stone-500">{t('reader.empty')}</p>;

  const visibleChapters = project.chapters.flatMap((_, i) => (!onlyErrors || (errors.perChapter[i] ?? 0) > 0 ? [i] : []));
  const rows = onlyErrors ? chapter.segments.filter((s) => s.status === 'error') : chapter.segments;
  const toggleOnlyErrors = (value: boolean) => {
    setOnlyErrors(value);
    // The chapter on screen would be empty: land on the first one that still has errors.
    const first = errors.locations[0];
    if (value && first && (errors.perChapter[index] ?? 0) === 0) setIndex(first.chapter);
  };
  const showControls = errors.locations.length > 0 || onlyErrors;

  return (
    <div className="grid gap-5 md:grid-cols-[15rem_minmax(0,1fr)]">
      <ReaderChapterList
        chapters={project.chapters}
        progress={progress}
        errors={errors}
        visible={visibleChapters}
        current={project.chapters.indexOf(chapter)}
        onSelect={selectChapter}
      />
      <section ref={contentRef} className="min-w-0 rounded-2xl border border-stone-200 bg-white px-4 shadow-sm sm:px-6 dark:border-stone-800 dark:bg-stone-900">
        <div className="sticky top-14 z-10 -mx-4 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-stone-800 dark:bg-stone-900/95">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="min-w-0 flex-1 truncate font-semibold">{chapter.title || chapter.href}</h2>
            <fieldset className="flex rounded-lg border border-stone-300 p-0.5 text-xs dark:border-stone-700">
              <legend className="sr-only">{t('reader.view')}</legend>
              {(['side', 'interleaved'] as const).map((m) => (
                <label key={m} className={`cursor-pointer rounded-md px-2.5 py-1 ${mode === m ? 'bg-teal-700 text-white' : ''}`}>
                  <input type="radio" name="reader-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                  {m === 'side' ? t('reader.sideBySide') : t('reader.interleaved')}
                </label>
              ))}
            </fieldset>
          </div>
          {showControls && (
            <ReaderErrorControls
              total={errors.locations.length}
              ordinal={cursor ? errorOrdinal(errors, cursor.id) : undefined}
              canStep={{ '-1': Boolean(adjacent[-1]), 1: Boolean(adjacent[1]) }}
              onStep={step}
              onlyErrors={onlyErrors}
              onOnlyErrorsChange={toggleOnlyErrors}
              retry={{
                running: retrying,
                // Resuming only navigates to the setup page, which shows the estimate and its own Start guards.
                resume: resumeInstead ? { pending: unfinished, failed: errors.locations.length } : undefined,
                blockedHint: resumeInstead
                  ? undefined
                  : sampleRunning
                    ? t('sample.blocksRun')
                    : hintsRunning
                      ? t('hints.blocksRun')
                      : busyElsewhere
                        ? t('run.busyElsewhere')
                        : undefined,
                busyElsewhere,
                error: retryError,
                onRetry: () => (resumeInstead ? navigate({ name: 'book', id: project.id, tab: 'setup' }) : void retryAll()),
                onPause: () => pauseJob(project.id),
              }}
            />
          )}
        </div>
        {mode === 'side' && (
          <div className="hidden grid-cols-2 gap-6 pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid">
            <span>{t('reader.source')}</span>
            <span>{t('reader.translation')}</span>
          </div>
        )}
        {chapter.segments.length === 0 ? (
          <p className="py-6 text-sm text-stone-500">{t('reader.emptyChapter')}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-stone-500">{t('reader.noErrorsInChapter')}</p>
        ) : (
          rows.map((s) => <SegmentRow key={s.id} project={project} segment={s} mode={mode} provider={provider} flash={s.id === flashId} />)
        )}
      </section>
    </div>
  );
}
