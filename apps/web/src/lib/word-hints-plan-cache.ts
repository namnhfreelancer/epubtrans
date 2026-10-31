import {
  estimateWordHintsCost,
  type FrequencyList,
  type Project,
  type ProjectSettings,
  planWordHints,
  type WordHintsEstimate,
  type WordHintsPlan,
} from '@epubtrans/core';

/** A hints plan with its estimate and what it was computed from, so the Generate button can reuse it. */
export interface CachedWordHintsPlan {
  plan: WordHintsPlan;
  estimate: WordHintsEstimate;
  /** Project version the plan was computed at (bumped by every in-place change: settings, segments, new hints). */
  version: number;
  /** {@link planInputsKey} of the settings and list it used. */
  key: string;
}

/** The settings a plan depends on (language pair, level, glossary names) and the frequency list it ranked against. */
export function planInputsKey(settings: ProjectSettings, list: FrequencyList): string {
  const hints = settings.wordHints;
  return JSON.stringify([list.lang, list.size, settings.sourceLang, settings.targetLang, hints?.level, hints?.glossLang, settings.glossary]);
}

/**
 * Plans the hints run and estimates it. Scanning the whole book takes a noticeable moment on long books, so callers
 * run this off the click path (scheduled when idle) and keep the result.
 */
export function computeWordHintsPlan(
  project: Project,
  list: FrequencyList,
  version: number,
  prices: Pick<ProjectSettings, 'priceInPerM' | 'priceOutPerM'>,
): CachedWordHintsPlan {
  const plan = planWordHints(project, list, project.settings);
  return { plan, estimate: estimateWordHintsCost(plan.candidates, prices, plan), version, key: planInputsKey(project.settings, list) };
}

/**
 * The plan to run when Generate is clicked: the cached one while it is current (same project version and plan
 * inputs), else a fresh one, e.g. when another tab added hints and the scheduled refresh has not run yet.
 */
export function planForRun(
  cached: CachedWordHintsPlan | undefined,
  project: Project,
  list: FrequencyList,
  settings: ProjectSettings,
  version: number,
): WordHintsPlan {
  if (cached && cached.version === version && cached.key === planInputsKey(settings, list)) return cached.plan;
  return planWordHints(project, list, settings);
}
