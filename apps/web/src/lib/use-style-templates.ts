import { useEffect, useState } from 'react';
import { styleTemplates } from './app-services';
import { createExternalStore, useExternalStore } from './external-store';
import type { SavedStyleTemplate } from './style-template-store';

/** Bumped after every template change in this tab, so every mounted list re-reads. */
export const styleTemplatesVersion = createExternalStore(0);

export const touchStyleTemplates = (): void => styleTemplatesVersion.set(styleTemplatesVersion.get() + 1);

/** The saved style templates, re-read whenever this tab changes them. */
export function useStyleTemplates(): { templates: SavedStyleTemplate[]; error?: string } {
  const version = useExternalStore(styleTemplatesVersion);
  const [state, setState] = useState<{ templates: SavedStyleTemplate[]; error?: string }>({ templates: [] });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refresh trigger.
  useEffect(() => {
    let live = true;
    styleTemplates.list().then(
      (templates) => live && setState({ templates }),
      (err: unknown) => live && setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) })),
    );
    return () => {
      live = false;
    };
  }, [version]);
  return state;
}
