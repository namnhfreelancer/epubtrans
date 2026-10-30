import { PROVIDER_PRESETS } from '@epubtrans/core';
import { createExternalStore } from './external-store';
import { browserStorage, type KeyValueStorage, readString, removeKey, writeString } from './safe-storage';

const PREFIX = 'epubtrans:apiKey:';

export interface ApiKeyState {
  /** Provider id → key. */
  keys: Record<string, string>;
  /** Provider ids whose key is persisted on this device. */
  remembered: Record<string, boolean>;
}

/**
 * API keys per provider. By default a key lives in memory only (lost on reload);
 * when the user opts in, it is also written to localStorage. Keys are never logged or sent anywhere
 * except to the selected provider by core's provider adapters.
 */
export function createApiKeyStore(storage: KeyValueStorage | undefined, providerIds: string[]) {
  const initial: ApiKeyState = { keys: {}, remembered: {} };
  for (const id of providerIds) {
    const stored = readString(storage, PREFIX + id);
    initial.keys[id] = stored ?? '';
    initial.remembered[id] = stored !== null;
  }
  const state = createExternalStore(initial);

  const update = (providerId: string, key: string, remembered: boolean) => {
    const current = state.get();
    state.set({ keys: { ...current.keys, [providerId]: key }, remembered: { ...current.remembered, [providerId]: remembered } });
  };

  return {
    store: state,
    getKey: (providerId: string): string => state.get().keys[providerId] ?? '',
    isRemembered: (providerId: string): boolean => state.get().remembered[providerId] === true,
    /**
     * Sets the key. With `remember`, the key is also written to localStorage; otherwise any stored copy is removed.
     * Returns false when remembering was requested but storage is unavailable (the key is then kept in memory).
     */
    setKey(providerId: string, key: string, remember: boolean): boolean {
      const value = key.trim();
      let ok = true;
      if (remember && value) ok = writeString(storage, PREFIX + providerId, value);
      else removeKey(storage, PREFIX + providerId);
      update(providerId, value, remember && ok);
      return ok;
    },
    clearKey(providerId: string): void {
      removeKey(storage, PREFIX + providerId);
      update(providerId, '', false);
    },
  };
}

export type ApiKeyStore = ReturnType<typeof createApiKeyStore>;

export const apiKeys = createApiKeyStore(
  browserStorage(),
  PROVIDER_PRESETS.map((p) => p.id),
);
