import {
  EXPORT_MODES,
  type ExportMode,
  getProviderPreset,
  MAX_CONCURRENCY,
  PROVIDER_PRESETS,
  type ProjectSettings,
  type ProviderPreset,
} from '@epubtrans/core';
import { UsageError } from './args';
import type { ProviderFlagValues, RunFlagValues } from './flag-specs';

export interface ProviderSelection {
  preset: ProviderPreset;
  baseURL: string;
}

/**
 * Provider choice: `--provider`, else the project's provider, else `custom` when only `--base-url`
 * is given, else `openai`. The endpoint is never taken from a project file: project files are shared
 * (web app, other people), so a stored base URL could redirect the API key. Built-in presets use their
 * own endpoint unless `--base-url` is passed on this run; `custom` requires `--base-url` on every run.
 */
export function selectProvider(flags: ProviderFlagValues, current?: Pick<ProjectSettings, 'providerId'>): ProviderSelection {
  const id = flags.provider ?? current?.providerId ?? (flags['base-url'] ? 'custom' : 'openai');
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new UsageError(`Unknown provider "${id}". Available: ${PROVIDER_PRESETS.map((p) => p.id).join(', ')}`);
  const baseURL = (flags['base-url'] ?? preset.baseURL).trim();
  if (!baseURL) {
    throw new UsageError(`Provider "${preset.id}" needs --base-url on every run (an endpoint stored in a project file is never trusted with your API key)`);
  }
  return { preset: getProviderPreset(preset.id), baseURL };
}

export function parseExportMode(value: string | undefined): ExportMode {
  const mode = value ?? 'bilingual';
  if (!(EXPORT_MODES as string[]).includes(mode)) throw new UsageError(`Unknown --mode "${mode}". Use one of: ${EXPORT_MODES.join(', ')}`);
  return mode as ExportMode;
}

/** BCP 47 tag check; core turns tags into language names for the prompt. */
export function parseLanguage(value: string, flag: string): string {
  const tag = value.trim();
  try {
    if (tag && Intl.getCanonicalLocales(tag).length === 1) return tag;
  } catch {
    // fall through to the usage error
  }
  throw new UsageError(`${flag} must be a language code such as "en", "vi" or "pt-BR", got "${value}"`);
}

/** Applies run-time flags (model, concurrency, review pass, prices) over the project's settings. */
export function applyRunFlags(settings: ProjectSettings, flags: RunFlagValues, selection: ProviderSelection): ProjectSettings {
  const { concurrency, 'price-in': priceIn, 'price-out': priceOut } = flags;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY)) {
    throw new UsageError(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }
  for (const [name, value] of [
    ['--price-in', priceIn],
    ['--price-out', priceOut],
  ] as const) {
    if (value !== undefined && value < 0) throw new UsageError(`${name} must not be negative`);
  }
  return {
    ...settings,
    providerId: selection.preset.id,
    baseURL: selection.baseURL,
    model: flags.model?.trim() || settings.model,
    concurrency: concurrency ?? settings.concurrency,
    twoPass: flags['two-pass'] === true ? true : settings.twoPass,
    ...(priceIn !== undefined ? { priceInPerM: priceIn } : {}),
    ...(priceOut !== undefined ? { priceOutPerM: priceOut } : {}),
  };
}
