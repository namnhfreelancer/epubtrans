import { useEffect, useRef, useState } from 'react';
import { repository } from './app-services';
import { useExternalStore } from './external-store';
import type { ProjectSummary } from './project-repository';
import { libraryVersion } from './project-store';

const REFRESH_INTERVAL_MS = 750;

interface LibraryState {
  books?: ProjectSummary[];
  error?: string;
}

/** Library summaries from IndexedDB, refreshed at most every 750 ms while books change. */
export function useLibrary(): LibraryState {
  const version = useExternalStore(libraryVersion);
  const [state, setState] = useState<LibraryState>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastFetch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refresh trigger.
  useEffect(() => {
    if (timer.current) return;
    const wait = Math.max(0, lastFetch.current + REFRESH_INTERVAL_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = undefined;
      lastFetch.current = Date.now();
      repository.listProjects().then(
        (books) => mounted.current && setState({ books }),
        (err: unknown) => mounted.current && setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) })),
      );
    }, wait);
  }, [version]);

  return state;
}
