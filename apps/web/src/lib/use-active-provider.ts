import type { ChatProvider, Project, ProjectSettings } from '@epubtrans/core';
import type { MessageKey } from '../i18n/messages-en';
import { apiKeys } from './api-key-store';
import { useExternalStore } from './external-store';
import { type ActiveProvider, buildProvider, providerConfig, resolveActiveProvider, settingsForRun } from './provider-config-store';

export interface ActiveProviderState {
  active: ActiveProvider;
  apiKey: string;
  /** Why translation cannot start yet, if anything is missing. */
  problem?: MessageKey;
  /** Creates the provider for `project` and the settings to run with; throws on invalid configuration. */
  prepare(project: Project): { provider: ChatProvider; settings: ProjectSettings };
}

export function useActiveProvider(): ActiveProviderState {
  const config = useExternalStore(providerConfig.store);
  const keys = useExternalStore(apiKeys.store);
  const active = resolveActiveProvider(config);
  const apiKey = keys.keys[active.providerId] ?? '';
  let problem: MessageKey | undefined;
  if (!active.baseURL) problem = 'settings.baseUrlInvalid';
  else if (!apiKey && active.providerId !== 'custom') problem = 'run.needKey';
  else if (!active.model) problem = 'run.needModel';
  return {
    active,
    apiKey,
    problem,
    prepare: (project) => ({ provider: buildProvider(active, apiKey), settings: settingsForRun(project.settings, active) }),
  };
}
