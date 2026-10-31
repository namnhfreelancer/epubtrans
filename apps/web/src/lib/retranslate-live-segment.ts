import { type Project, retranslateSegment, type Segment } from '@epubtrans/core';
import { locateSegment } from './error-index';
import { SettingsChangedError } from './project-repository';
import { refreshSettingsFromStorage } from './project-settings-store';
import { persistJobSegment, touchProject } from './project-store';
import { revisionOf, sameRevision } from './segment-revision';
import type { ActiveProviderState } from './use-active-provider';

/**
 * How a retranslation ended: saved; `changed`, the segment changed meanwhile (an edit, possibly in another tab) and
 * that version was kept; `settings-changed`, the book's target language changed or its translations were reset
 * meanwhile, so the result (in the old language) was discarded.
 */
export type RetranslateOutcome = { kind: 'saved'; segment: Segment } | { kind: 'changed' } | { kind: 'settings-changed' };

/**
 * Retranslates one segment of a book open in this tab (the reader's button, the WebMCP tool). The book's settings are
 * re-read from storage first, so the request uses the target language saved by any tab. A detached copy is sent: the
 * live segment stays whatever the user makes of it meanwhile, and the result is committed only if neither the segment
 * nor the book's settings (revision and target language) changed since the request started. The fresh machine
 * translation replaces a hand edit; with `keepEdits`, a segment edited by hand meanwhile counts as changed instead.
 * Throws when the request fails (the old translation stays) or the segment does not exist.
 */
export async function retranslateLiveSegment(
  project: Project,
  segmentId: string,
  provider: ActiveProviderState,
  options: { signal?: AbortSignal; keepEdits?: boolean } = {},
): Promise<RetranslateOutcome> {
  const guard = await refreshSettingsFromStorage(project);
  const { provider: chat, settings } = provider.prepare(project);
  const location = locateSegment(project.chapters, segmentId);
  const chapter = location && project.chapters[location.chapter];
  const live = chapter?.segments[location?.segment ?? -1];
  if (!chapter || !live) throw new Error(`No segment with id "${segmentId.slice(0, 80)}" in this book.`);
  const started = revisionOf(live);
  const detached: Project = { ...project, chapters: [{ ...chapter, segments: [{ ...live }] }] };
  const result = await retranslateSegment(detached, segmentId, chat, settings, options.signal);
  if ((options.keepEdits && live.userEdited) || !sameRevision(revisionOf(live), started)) {
    // A reset heard from another tab changes the live segment too: report the reason that applies.
    const now = await refreshSettingsFromStorage(project);
    const settingsChanged = now.revision !== guard.revision || now.targetLang.toLowerCase() !== guard.targetLang.toLowerCase();
    return { kind: settingsChanged ? 'settings-changed' : 'changed' };
  }

  // Same synchronous apply-then-compare-and-set as translation runs; a conflicting stored change reverts it.
  live.status = result.status;
  if (result.translationHtml === undefined) delete live.translationHtml;
  else live.translationHtml = result.translationHtml;
  if (result.error === undefined) delete live.error;
  else live.error = result.error;
  if (result.warning === undefined) delete live.warning;
  else live.warning = result.warning;
  delete live.userEdited;
  project.updatedAt = detached.updatedAt;
  touchProject(project.id);
  try {
    if (!(await persistJobSegment(project, live, new Map([[segmentId, started]]), guard))) return { kind: 'changed' };
  } catch (err) {
    if (err instanceof SettingsChangedError) return { kind: 'settings-changed' };
    throw err;
  }
  return { kind: 'saved', segment: live };
}
