import {
  EXPORT_MODES,
  type ExportMode,
  getProviderPreset,
  MAX_BATCH_SEGMENTS_LIMIT,
  MAX_CACHED_INPUT_RATIO,
  MAX_CONCURRENCY,
  MAX_IDENTICAL_MIN_LETTERS,
  PROVIDER_PRESETS,
  type ProjectSettings,
  type ProviderPreset,
  REASONING_LEVELS,
  type ReasoningLevel,
} from '@epubtrans/core';
import { UsageError } from './args';
import type { ProviderFlagValues, RunFlagValues } from './flag-specs';

/** Provider a fresh `translate` uses when neither `--provider` nor `--base-url` is given. */
export const DEFAULT_PROVIDER_ID = 'openai';

export interface ProviderSelection {
  preset: ProviderPreset;
  baseURL: string;
  /**
   * False when a provider other than the default came only from the project file (no --provider or
   * --base-url on this run): a shared file must not decide which provider receives the generic
   * EPUBTRANS_API_KEY. The default provider is exempt: a fresh import already sends the generic key there,
   * so re-running a command or resuming such a project adds no new recipient.
   */
  genericKeyAllowed: boolean;
}

/**
 * Provider choice: `--provider`, else the project's provider, else `custom` when only `--base-url`
 * is given, else `openai`. The endpoint is never taken from a project file: project files are shared
 * (web app, other people), so a stored base URL could redirect the API key. Built-in presets use their
 * own endpoint unless `--base-url` is passed on this run; `custom` requires `--base-url` on every run.
 * Likewise `EPUBTRANS_API_KEY` is only used for a provider the user named on this run, for the default provider,
 * or for a fresh import.
 */
export function selectProvider(flags: ProviderFlagValues, current?: Pick<ProjectSettings, 'providerId'>): ProviderSelection {
  const id = flags.provider ?? current?.providerId ?? (flags['base-url'] ? 'custom' : DEFAULT_PROVIDER_ID);
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new UsageError(`Unknown provider "${id}". Available: ${PROVIDER_PRESETS.map((p) => p.id).join(', ')}`);
  const baseURL = (flags['base-url'] ?? preset.baseURL).trim();
  if (!baseURL) {
    throw new UsageError(`Provider "${preset.id}" needs --base-url on every run (an endpoint stored in a project file is never trusted with your API key)`);
  }
  const fromProjectOnly =
    flags.provider === undefined && flags['base-url'] === undefined && current?.providerId !== undefined && current.providerId !== DEFAULT_PROVIDER_ID;
  return { preset: getProviderPreset(preset.id), baseURL, genericKeyAllowed: !fromProjectOnly };
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
  const cachedRatio = flags['cached-ratio'];
  if (cachedRatio !== undefined && (cachedRatio < 0 || cachedRatio > MAX_CACHED_INPUT_RATIO)) {
    throw new UsageError(`--cached-ratio must be between 0 and ${MAX_CACHED_INPUT_RATIO} (the cached input price as a fraction of --price-in)`);
  }
  const maxSegments = integerFlag('--max-segments', flags['max-segments'], 1, MAX_BATCH_SEGMENTS_LIMIT);
  const minLetters = integerFlag('--identical-min-letters', flags['identical-min-letters'], 0, MAX_IDENTICAL_MIN_LETTERS);
  const reasoning = parseReasoning(flags.reasoning);
  return {
    ...settings,
    providerId: selection.preset.id,
    baseURL: selection.baseURL,
    model: flags.model?.trim() || settings.model,
    concurrency: concurrency ?? settings.concurrency,
    twoPass: flags['two-pass'] === true ? true : settings.twoPass,
    ...(priceIn !== undefined ? { priceInPerM: priceIn } : {}),
    ...(priceOut !== undefined ? { priceOutPerM: priceOut } : {}),
    ...(cachedRatio !== undefined ? { cachedInputRatio: cachedRatio } : {}),
    ...(maxSegments !== undefined ? { maxSegmentsPerBatch: maxSegments } : {}),
    ...(minLetters !== undefined ? { identicalMinLetters: minLetters } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function integerFlag(name: string, value: number | undefined, min: number, max: number): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
    throw new UsageError(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function parseReasoning(value: string | undefined): ReasoningLevel | undefined {
  if (value === undefined) return undefined;
  const level = REASONING_LEVELS.find((l) => l === value.trim().toLowerCase());
  if (!level) throw new UsageError(`Unknown --reasoning "${value}". Use one of: ${REASONING_LEVELS.join(', ')}`);
  return level;
}
