import {
  type ChatProvider,
  createProvider,
  getProviderPreset,
  PROVIDER_PRESETS,
  type ProjectSettings,
  REASONING_LEVELS,
  type ReasoningLevel,
} from '@epubtrans/core';
import { createExternalStore } from './external-store';
import { browserStorage, isPlainObject, type KeyValueStorage, readJson, writeString } from './safe-storage';

const STORAGE_KEY = 'epubtrans:provider';

/** Per-provider choices (no secrets: the API key lives in the key store). */
export interface ProviderProfile {
  /** Only used by the custom preset; other presets always use their fixed base URL. */
  baseURL: string;
  model: string;
  /** USD per 1M tokens published by the provider for `model` (OpenRouter), used to prefill book prices. */
  priceInPerM?: number;
  priceOutPerM?: number;
  /** Reasoning effort for reasoning models; absent means the provider's default. */
  reasoning?: ReasoningLevel;
}

export interface ProviderConfig {
  providerId: string;
  profiles: Record<string, ProviderProfile>;
}

/** Provider fields of ProjectSettings resolved from the current configuration. */
export interface ActiveProvider {
  providerId: string;
  baseURL: string;
  model: string;
  priceInPerM?: number;
  priceOutPerM?: number;
  reasoning?: ReasoningLevel;
}

const DEFAULT_CONFIG: ProviderConfig = { providerId: PROVIDER_PRESETS[0]?.id ?? 'anthropic', profiles: {} };
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Validates persisted configuration; unknown providers and malformed profiles are dropped. */
export function parseProviderConfig(value: unknown): ProviderConfig | undefined {
  if (!isPlainObject(value) || typeof value.providerId !== 'string') return undefined;
  if (!PROVIDER_PRESETS.some((p) => p.id === value.providerId)) return undefined;
  const profiles: Record<string, ProviderProfile> = {};
  if (isPlainObject(value.profiles)) {
    for (const [id, raw] of Object.entries(value.profiles)) {
      if (!PROVIDER_PRESETS.some((p) => p.id === id) || !isPlainObject(raw)) continue;
      const priceInPerM = finite(raw.priceInPerM);
      const priceOutPerM = finite(raw.priceOutPerM);
      const reasoning = REASONING_LEVELS.find((level) => level !== 'default' && level === raw.reasoning);
      profiles[id] = {
        baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : '',
        model: typeof raw.model === 'string' ? raw.model : '',
        ...(priceInPerM !== undefined ? { priceInPerM } : {}),
        ...(priceOutPerM !== undefined ? { priceOutPerM } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
      };
    }
  }
  return { providerId: value.providerId, profiles };
}

export function resolveActiveProvider(config: ProviderConfig): ActiveProvider {
  const preset = getProviderPreset(config.providerId);
  const profile = config.profiles[preset.id] ?? { baseURL: '', model: '' };
  return {
    providerId: preset.id,
    baseURL: preset.id === 'custom' ? profile.baseURL.trim() : preset.baseURL,
    model: profile.model.trim(),
    ...(profile.priceInPerM !== undefined ? { priceInPerM: profile.priceInPerM } : {}),
    ...(profile.priceOutPerM !== undefined ? { priceOutPerM: profile.priceOutPerM } : {}),
    ...(profile.reasoning !== undefined ? { reasoning: profile.reasoning } : {}),
  };
}

/** Project settings for a run: the book's own choices plus the configured provider, model and reasoning setting. */
export function settingsForRun(settings: ProjectSettings, active: ActiveProvider): ProjectSettings {
  const { reasoning: _bookValue, ...rest } = settings;
  return {
    ...rest,
    providerId: active.providerId,
    baseURL: active.baseURL,
    model: active.model,
    ...(active.reasoning !== undefined ? { reasoning: active.reasoning } : {}),
  };
}

/** Creates the chat provider. The key is only ever sent to `active.baseURL` (enforced by core adapters). */
export function buildProvider(active: ActiveProvider, apiKey: string): ChatProvider {
  return createProvider(getProviderPreset(active.providerId), apiKey, active.baseURL, active.model, undefined, { reasoning: active.reasoning });
}

export function createProviderConfigStore(storage: KeyValueStorage | undefined) {
  const store = createExternalStore(readJson(storage, STORAGE_KEY, parseProviderConfig, DEFAULT_CONFIG));
  const save = (next: ProviderConfig) => {
    store.set(next);
    writeString(storage, STORAGE_KEY, JSON.stringify(next));
  };
  return {
    store,
    selectProvider(providerId: string): void {
      getProviderPreset(providerId);
      save({ ...store.get(), providerId });
    },
    updateProfile(providerId: string, patch: Partial<ProviderProfile>): void {
      const config = store.get();
      const current = config.profiles[providerId] ?? { baseURL: '', model: '' };
      const next: ProviderProfile = { ...current, ...patch };
      for (const k of ['priceInPerM', 'priceOutPerM'] as const) if (next[k] === undefined) delete next[k];
      if (next.reasoning === undefined || next.reasoning === 'default') delete next.reasoning;
      save({ ...config, profiles: { ...config.profiles, [providerId]: next } });
    },
  };
}

export const providerConfig = createProviderConfigStore(browserStorage());
