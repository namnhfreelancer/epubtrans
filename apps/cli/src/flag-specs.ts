import type { FlagSpecs, ParsedFlags } from './args';

/** Provider and run-tuning flags shared by translate, resume and models. */
export const PROVIDER_FLAGS = {
  provider: { type: 'string' },
  'base-url': { type: 'string' },
  model: { type: 'string' },
  'api-key-file': { type: 'string' },
} as const satisfies FlagSpecs;

export const RUN_FLAGS = {
  ...PROVIDER_FLAGS,
  concurrency: { type: 'number' },
  'two-pass': { type: 'boolean' },
  'price-in': { type: 'number' },
  'price-out': { type: 'number' },
  'no-price-lookup': { type: 'boolean' },
  mode: { type: 'string' },
  out: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
} as const satisfies FlagSpecs;

export const TRANSLATE_FLAGS = {
  ...RUN_FLAGS,
  project: { type: 'string' },
  to: { type: 'string' },
  from: { type: 'string' },
  'guideline-preset': { type: 'string' },
  'guideline-file': { type: 'string' },
  'generate-guide': { type: 'boolean' },
} as const satisfies FlagSpecs;

export const RESUME_FLAGS = RUN_FLAGS;

export const SAMPLE_FLAGS = {
  ...PROVIDER_FLAGS,
  concurrency: { type: 'number' },
  'two-pass': { type: 'boolean' },
  'price-in': { type: 'number' },
  'price-out': { type: 'number' },
  yes: { type: 'boolean', short: 'y' },
  project: { type: 'string' },
  to: { type: 'string' },
  from: { type: 'string' },
  passages: { type: 'number' },
  words: { type: 'number' },
  seed: { type: 'number' },
  new: { type: 'boolean' },
} as const satisfies FlagSpecs;

export const EXPORT_FLAGS = {
  mode: { type: 'string' },
  out: { type: 'string' },
} as const satisfies FlagSpecs;

export const MODELS_FLAGS = PROVIDER_FLAGS;

export type ProviderFlagValues = ParsedFlags<typeof PROVIDER_FLAGS>;
export type RunFlagValues = ParsedFlags<typeof RUN_FLAGS>;
