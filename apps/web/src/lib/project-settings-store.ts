import type { Project, ProjectSettings } from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { repository } from './app-services';
import { broadcast, onCrossTabMessage } from './cross-tab-channel';
import { runWithJobLock } from './cross-tab-job-lock';
import type { SettingsGuard } from './project-repository';
import { cachedProject, enqueueWrite, touchProject } from './project-store';
import { applyStoredState, revisionOf } from './segment-revision';

/**
 * Settings of the opened books, kept consistent across tabs. Storage is the source of truth: a change is saved as a
 * patch merged into the stored settings (never as a whole copy that could carry stale values from this tab), then the
 * other tabs are told to re-read the settings. Runs re-read them right before sending anything, and guard their writes
 * with the settings revision and target language they read (see `SettingsGuard`).
 */

/** Patches applied in memory whose write has not finished yet, per book, in order. */
const pendingPatches = new Map<string, Partial<ProjectSettings>[]>();
/** Bumped when settings changed in another tab, so forms that keep their own input state can start over from them. */
const syncVersions = new Map<string, number>();
const syncListeners = new Set<() => void>();

const subscribeSync = (l: () => void) => {
  syncListeners.add(l);
  return () => {
    syncListeners.delete(l);
  };
};

/** Changes whenever the book's settings were replaced by what another tab saved. */
export const useSettingsSync = (projectId: string): number => useSyncExternalStore(subscribeSync, () => syncVersions.get(projectId) ?? 0);

function bumpSync(projectId: string): void {
  syncVersions.set(projectId, (syncVersions.get(projectId) ?? 0) + 1);
  for (const l of [...syncListeners]) l();
}

/** Stored settings with this tab's not-yet-written patches on top. */
function withPendingPatches(projectId: string, stored: ProjectSettings): ProjectSettings {
  let settings = stored;
  for (const patch of pendingPatches.get(projectId) ?? []) settings = { ...settings, ...patch };
  return settings;
}

/** Applies a settings patch in memory immediately and persists it (merged into the stored settings). */
export function updateSettings(project: Project, patch: Partial<ProjectSettings>): Promise<void> {
  project.settings = { ...project.settings, ...patch };
  project.updatedAt = new Date().toISOString();
  touchProject(project.id);
  const pending = pendingPatches.get(project.id) ?? [];
  pending.push(patch);
  pendingPatches.set(project.id, pending);
  return enqueueWrite(project.id, async () => {
    try {
      await repository.saveSettings(project.id, patch);
    } finally {
      pending.splice(pending.indexOf(patch), 1);
    }
    broadcast(project.id, { type: 'settings', reset: false });
  });
}

/**
 * Saves a patch produced for `targetLang` (a generated guideline and glossary) only if the stored target language is
 * still that one; rejects with `SettingsChangedError` otherwise. The live project changes only once storage did.
 */
export function updateSettingsForTarget(project: Project, patch: Partial<ProjectSettings>, targetLang: string): Promise<void> {
  return enqueueWrite(project.id, async () => {
    const stored = await repository.saveSettings(project.id, patch, { targetLang });
    project.settings = withPendingPatches(project.id, stored);
    project.updatedAt = new Date().toISOString();
    touchProject(project.id);
    broadcast(project.id, { type: 'settings', reset: false });
  });
}

/** Re-reads the stored settings into the live project (see `refreshSettingsFromStorage`); also says whether they changed. */
function reloadSettings(project: Project): Promise<{ guard: SettingsGuard; changed: boolean }> {
  return enqueueWrite(project.id, async () => {
    const { settings, revision } = await repository.loadSettings(project.id);
    const next = withPendingPatches(project.id, settings);
    const changed = JSON.stringify(next) !== JSON.stringify(project.settings);
    if (changed) {
      project.settings = next;
      touchProject(project.id);
    }
    return { guard: { revision, targetLang: next.targetLang }, changed };
  });
}

/**
 * Re-reads the book's settings from storage into the live project, behind this tab's pending writes (patches not
 * written yet stay applied on top). Resolves the guard a run checks its writes against. Rejects with
 * `ProjectNotFoundError` when the book is gone.
 */
export const refreshSettingsFromStorage = async (project: Project): Promise<SettingsGuard> => (await reloadSettings(project)).guard;

/** Segments holding a translation (finished, reviewed, edited, or a draft kept by a failed review). */
export const translatedSegmentCount = (project: Project): number =>
  project.chapters.reduce((n, c) => n + c.segments.filter((s) => s.translationHtml !== undefined).length, 0);

/** True when changing the target language would leave translations into the old language behind. */
export const targetChangeNeedsDecision = (project: Project, targetLang: string): boolean =>
  targetLang.toLowerCase() !== project.settings.targetLang.toLowerCase() && translatedSegmentCount(project) > 0;

/**
 * Applies a settings patch (a new target language) and resets every segment to pending: translations, errors, hand
 * edits and warnings are dropped. Runs under the book's cross-tab job lock, so it never races a translation or sample
 * run in any tab; resolves 'busy' (changing nothing) while one holds the lock. Storage is updated first, in one
 * transaction that also bumps the settings revision (a retranslation still in flight anywhere can no longer store
 * its result), then the in-memory project, then other tabs are told to re-read settings and segments.
 */
export async function updateSettingsAndResetTranslations(project: Project, patch: Partial<ProjectSettings>): Promise<'done' | 'busy'> {
  const ran = await runWithJobLock(project.id, async () => {
    const stored = await enqueueWrite(project.id, () => repository.saveSettingsAndResetSegments(project.id, patch));
    for (const chapter of project.chapters) {
      for (const s of chapter.segments) {
        s.status = 'pending';
        delete s.translationHtml;
        delete s.error;
        delete s.userEdited;
        delete s.warning;
      }
    }
    project.settings = withPendingPatches(project.id, stored.settings);
    project.updatedAt = new Date().toISOString();
    touchProject(project.id);
    broadcast(project.id, { type: 'settings', reset: true });
  });
  return ran ? 'done' : 'busy';
}

/** Re-reads every segment's state after another tab reset the book's translations. */
async function refreshAllSegments(project: Project): Promise<void> {
  const since = new Map(project.chapters.flatMap((c) => c.segments.map((s) => [s.id, revisionOf(s)] as const)));
  await enqueueWrite(project.id, async () => {
    const stored = await repository.loadSegmentStates(project.id);
    let changed = false;
    for (const chapter of project.chapters) {
      for (const s of chapter.segments) {
        const before = since.get(s.id);
        if (before && applyStoredState(s, before, stored.get(s.id))) changed = true;
      }
    }
    if (changed) touchProject(project.id);
  });
}

/** Another tab changed a book's settings (and maybe reset its translations): re-read what changed from storage. */
onCrossTabMessage((projectId, message) => {
  if (message.type !== 'settings') return;
  const project = cachedProject(projectId);
  if (!project) return;
  const refresh = async () => {
    if (message.reset) await refreshAllSegments(project);
    if ((await reloadSettings(project)).changed) bumpSync(projectId);
  };
  refresh().catch((err: unknown) => console.warn('epubtrans: could not refresh settings changed in another tab', err));
});
