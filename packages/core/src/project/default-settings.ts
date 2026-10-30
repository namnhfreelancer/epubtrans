import { getProviderPreset } from '../providers/provider-presets';
import { getGuidelinePreset } from '../translate/guideline-presets';
import type { ProjectSettings } from '../types';

export const DEFAULT_CONCURRENCY = 3;

/** Settings for a newly imported book; callers override what the user chose. */
export function createDefaultSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  const preset = getProviderPreset('anthropic');
  return {
    sourceLang: 'auto',
    targetLang: 'vi',
    providerId: preset.id,
    baseURL: preset.baseURL,
    model: '',
    concurrency: DEFAULT_CONCURRENCY,
    twoPass: false,
    guideline: getGuidelinePreset('general').guideline,
    glossary: [],
    ...overrides,
  };
}
