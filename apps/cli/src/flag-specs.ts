import type { FlagSpecs, ParsedFlags } from './args';

/** Provider and run-tuning flags shared by translate, resume and models. */
export const PROVIDER_FLAGS = {
  provider: { type: 'string' },
  'base-url': { type: 'string' },
  model: { type: 'string' },
  'api-key-file': { type: 'string' },
} as const satisfies FlagSpecs;

/** Request and accounting tuning shared by every command that translates. */
const TUNING_FLAGS = {
  concurrency: { type: 'number' },
  'two-pass': { type: 'boolean' },
  'price-in': { type: 'number' },
  'price-out': { type: 'number' },
  'cached-ratio': { type: 'number' },
  'no-price-lookup': { type: 'boolean' },
  'max-segments': { type: 'number' },
  reasoning: { type: 'string' },
  'identical-min-letters': { type: 'number' },
  yes: { type: 'boolean', short: 'y' },
} as const satisfies FlagSpecs;

export const RUN_FLAGS = {
  ...PROVIDER_FLAGS,
  ...TUNING_FLAGS,
  mode: { type: 'string' },
  out: { type: 'string' },
} as const satisfies FlagSpecs;

export const TRANSLATE_FLAGS = {
  ...RUN_FLAGS,
  project: { type: 'string' },
  to: { type: 'string' },
  from: { type: 'string' },
  'guideline-preset': { type: 'string' },
  'guideline-file': { type: 'string' },
  'glossary-file': { type: 'string' },
  'generate-guide': { type: 'boolean' },
} as const satisfies FlagSpecs;

export const RESUME_FLAGS = RUN_FLAGS;

export const SAMPLE_FLAGS = {
  ...PROVIDER_FLAGS,
  ...TUNING_FLAGS,
  project: { type: 'string' },
  to: { type: 'string' },
  from: { type: 'string' },
  'glossary-file': { type: 'string' },
  passages: { type: 'number' },
  words: { type: 'number' },
  seed: { type: 'number' },
  new: { type: 'boolean' },
} as const satisfies FlagSpecs;

export const EXPORT_FLAGS = {
  mode: { type: 'string' },
  out: { type: 'string' },
} as const satisfies FlagSpecs;

export const GLOSSARY_EXPORT_FLAGS = {
  out: { type: 'string' },
  format: { type: 'string' },
} as const satisfies FlagSpecs;

export const MODELS_FLAGS = PROVIDER_FLAGS;

export type ProviderFlagValues = ParsedFlags<typeof PROVIDER_FLAGS>;
export type RunFlagValues = ParsedFlags<typeof TUNING_FLAGS> & ProviderFlagValues;
