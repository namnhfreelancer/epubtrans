import {
  type ChatProvider,
  DEFAULT_GLOSSARY_CAP,
  type GeneratedGuide,
  type GuideProgress,
  generateGuide,
  type Project,
  type ProjectSettings,
} from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { errorText } from './notices';
import { refreshSettingsFromStorage, updateSettingsForTarget } from './project-settings-store';

/** Guideline and glossary generation of one book, shown by the guideline card whoever started it (the user or an agent). */
export type GuideJobState =
  | { kind: 'idle' }
  | { kind: 'busy'; progress?: GuideProgress }
  | { kind: 'done'; entries: number; candidates: number; skippedBatches: number }
  | { kind: 'error'; message: string };

/** How a generation run ended: the generated guide (already saved to the book), cancelled, or failed. */
export type GuideRunResult = { kind: 'done'; guide: GeneratedGuide } | { kind: 'cancelled' } | { kind: 'error'; message: string };

const IDLE: GuideJobState = { kind: 'idle' };
const states = new Map<string, GuideJobState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function setState(projectId: string, next: GuideJobState): void {
  states.set(projectId, next);
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const getGuideJobState = (projectId: string): GuideJobState => states.get(projectId) ?? IDLE;

export const useGuideJob = (projectId: string): GuideJobState => useSyncExternalStore(subscribe, () => getGuideJobState(projectId));

export const isGuideJobRunning = (projectId: string): boolean => controllers.has(projectId);

/** Shows a problem found before generation could start (e.g. no API key) in the book's guideline card. */
export function reportGuideProblem(projectId: string, message: string): void {
  setState(projectId, { kind: 'error', message });
}

/**
 * Drafts the book's guideline and glossary and saves them to the book. A run already in progress for the book is
 * cancelled first (a newer request wins, as the card's button always did). The book's settings are re-read from
 * storage first; `prepare` then builds the provider and run settings from them (when it throws, the run ends as an
 * error). The result is saved only if the book's target language is still the one it was generated for. Never rejects.
 */
export async function runGuideJob(
  project: Project,
  prepare: () => { provider: ChatProvider; settings: ProjectSettings },
  maxEntries: number = DEFAULT_GLOSSARY_CAP,
): Promise<GuideRunResult> {
  controllers.get(project.id)?.abort();
  const controller = new AbortController();
  controllers.set(project.id, controller);
  setState(project.id, { kind: 'busy' });
  try {
    const { targetLang } = await refreshSettingsFromStorage(project);
    if (controller.signal.aborted) return { kind: 'cancelled' };
    const { provider, settings } = prepare();
    const guide = await generateGuide(project, provider, settings, {
      signal: controller.signal,
      maxEntries,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setState(project.id, { kind: 'busy', progress });
      },
    });
    // A cancelled run saves nothing: its book may be deleted, or the user moved on.
    if (controller.signal.aborted) return { kind: 'cancelled' };
    await updateSettingsForTarget(project, { guideline: guide.guideline, glossary: guide.glossary }, targetLang);
    if (controller.signal.aborted) return { kind: 'cancelled' };
    setState(project.id, { kind: 'done', entries: guide.glossary.length, candidates: guide.candidates, skippedBatches: guide.skippedBatches });
    return { kind: 'done', guide };
  } catch (err) {
    if (controller.signal.aborted) return { kind: 'cancelled' };
    const message = errorText(err);
    setState(project.id, { kind: 'error', message });
    return { kind: 'error', message };
  } finally {
    if (controllers.get(project.id) === controller) controllers.delete(project.id);
  }
}

/** Stops the book's generation run, if any, and clears its status. */
export function cancelGuideJob(projectId: string): void {
  const controller = controllers.get(projectId);
  if (!controller) return;
  controller.abort();
  controllers.delete(projectId);
  setState(projectId, IDLE);
}
