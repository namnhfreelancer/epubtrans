import { type ExportMode, exportEpub, type Project } from '@epubtrans/core';
import { useEffect, useRef, useState } from 'react';
import { browserDomEnv } from '../lib/dom-env';
import { errorText } from '../lib/notices';
import { previewFingerprint } from './preview-fingerprint';

/** Quiet time after the last project change before the preview is rebuilt. */
export const REBUILD_DEBOUNCE_MS = 700;
/** Upper bound while changes keep coming (a running translation), so the preview still follows along. */
export const REBUILD_MAX_WAIT_MS = 4000;

/** Delay before the next rebuild, given when the first unbuilt change happened. */
export function rebuildDelay(now: number, firstPendingAt: number): number {
  return Math.max(0, Math.min(REBUILD_DEBOUNCE_MS, firstPendingAt + REBUILD_MAX_WAIT_MS - now));
}

export interface PreviewBuild {
  /** Latest preview EPUB; kept while a newer one is being built. */
  bytes?: Uint8Array;
  building: boolean;
  error?: string;
}

/**
 * Exports the project as the preview build (segment ids and issue classes kept) whenever it or the mode changes.
 * Edits are debounced; the first build and mode switches start at once. Builds run one at a time; a build that a
 * newer change has overtaken, or whose inputs are unchanged ({@link previewFingerprint}), is skipped.
 */
export function usePreviewExport(project: Project, version: number, mode: ExportMode): PreviewBuild {
  const [state, setState] = useState<PreviewBuild>({ building: true });
  const firstPendingAt = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const builtFor = useRef<{ project: Project; mode: ExportMode; fingerprint: string } | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  useEffect(() => {
    const ticket = ++generation.current;
    const now = Date.now();
    firstPendingAt.current ??= now;
    const immediate = builtFor.current?.project !== project || builtFor.current.mode !== mode;
    const delay = immediate ? 0 : rebuildDelay(now, firstPendingAt.current);
    const build = async () => {
      if (ticket !== generation.current) return;
      firstPendingAt.current = undefined;
      const fingerprint = previewFingerprint(project, mode);
      // Nothing the export depends on changed (a job finishing, a refresh with no news): keep the current preview.
      if (builtFor.current?.project === project && builtFor.current.fingerprint === fingerprint) return;
      builtFor.current = { project, mode, fingerprint };
      setState((s) => ({ ...s, building: true }));
      try {
        const bytes = await exportEpub(project, mode, browserDomEnv(), { preview: true });
        if (ticket === generation.current) setState({ bytes, building: false });
      } catch (err) {
        if (ticket === generation.current) setState((s) => ({ ...s, building: false, error: errorText(err) }));
      }
    };
    const timer = setTimeout(() => {
      queue.current = queue.current.then(build);
    }, delay);
    return () => clearTimeout(timer);
  }, [project, version, mode]);

  return state;
}
