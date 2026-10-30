/**
 * @epubtrans/core — environment-agnostic book import, translation and export.
 * DOM access goes through an injected DomEnv; HTTP goes through an injectable fetch.
 */

export { EXPORT_MODES, exportEpub } from './export/export-epub';
export { detectFormat } from './formats/detect-format';
export { importBook, TOC_CHAPTER_TITLE } from './import/import-book';
export { detectLanguage, iso6393ToBcp47 } from './lang/detect-language';
export { createDefaultSettings, DEFAULT_CONCURRENCY } from './project/default-settings';
export { loadProjectFile, saveProjectFile, validateProjectState } from './project/project-file';
export { createProvider } from './providers/create-provider';
export { ProviderError } from './providers/provider-http';
export { getProviderPreset, PROVIDER_PRESETS } from './providers/provider-presets';
export { estimateCost } from './translate/estimate-cost';
export { generateGuide } from './translate/generate-guide';
export { GUIDELINE_PRESETS, type GuidelinePreset, type GuidelinePresetId, getGuidelinePreset } from './translate/guideline-presets';
export { retranslateSegment } from './translate/retranslate-segment';
export { estimateTokens, languageName } from './translate/token-estimate';
export { MAX_BATCH_TOKENS, MAX_CONCURRENCY, makeBatches, translateProject } from './translate/translate-project';
export type * from './types';
