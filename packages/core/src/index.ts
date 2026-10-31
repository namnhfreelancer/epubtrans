/**
 * @epubtrans/core — environment-agnostic book import, translation and export.
 * DOM access goes through an injected DomEnv; HTTP goes through an injectable fetch.
 */

export { attributionText } from './export/attribution-page';
export { EXPORT_MODES, type ExportOptions, exportEpub, HINT_EXPORT_MODES } from './export/export-epub';
export { exportIdentifier } from './export/export-identifier';
export { PREVIEW_ERROR_CLASS, PREVIEW_PENDING_CLASS, PREVIEW_SEGMENT_ATTR } from './export/preview-markers';
export {
  EMBEDDED_FONT_FILES,
  EMBEDDED_FONTS,
  type EmbeddedFont,
  type EmbeddedFontFace,
  EXPORT_FONT_IDS,
  embeddedFont,
  embeddedFontsSize,
  type FontFileLoader,
  GENERIC_FONTS,
} from './export-style/embedded-fonts';
export { embeddedFontsFor, exportStyleCss } from './export-style/export-style-css';
export { exportStylePreset, matchingPreset, sameExportStyle } from './export-style/export-style-presets';
export {
  EXPORT_FONT_WEIGHTS,
  EXPORT_STYLE_PRESET_IDS,
  ExportStyleError,
  type IgnoredKeyHandler,
  normalizeColor,
  STYLE_LIMITS,
  validateExportStyle,
} from './export-style/export-style-validation';
export {
  MAX_STYLE_FILE_BYTES,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TEMPLATES_PER_FILE,
  type ParsedStyleFile,
  type ParsedStyleTemplates,
  parseStyleFile,
  parseStyleTemplatesJson,
  serializeStyleTemplates,
  validateStyleTemplate,
  validateTemplateName,
} from './export-style/style-templates';
export { detectFormat } from './formats/detect-format';
export { type ExtractCandidatesOptions, extractGlossaryCandidates, type GlossaryCandidate } from './glossary/extract-candidates';
export { foldGlossaryKey, GLOSSARY_TERM_TYPES } from './glossary/glossary-entry';
export {
  applyGlossaryImport,
  formatGlossaryFile,
  GLOSSARY_FILE_COLUMNS,
  GlossaryFileError,
  type GlossaryFileFormat,
  type GlossaryImportMode,
  type GlossaryImportResult,
  glossaryFileFormat,
  MAX_GLOSSARY_FILE_CHARS,
  type ParsedGlossaryFile,
  parseGlossaryFile,
} from './glossary/glossary-file';
export { selectGlossaryEntries } from './glossary/glossary-matcher';
export { compareGlossaryEntries, DEFAULT_GLOSSARY_CAP, glossaryLimit, mergeGlossary } from './glossary/merge-glossary';
export { importBook, TOC_CHAPTER_TITLE } from './import/import-book';
export { detectLanguage, iso6393ToBcp47 } from './lang/detect-language';
export { type CachedCatalog, PRICING_CACHE_TTL_MS, type PricingCacheStorage, withPricingCache } from './pricing/cached-pricing-source';
export { lookupModelPricing } from './pricing/lookup-model-pricing';
export { DEFAULT_PRICING_SOURCES, liteLlmSource, openRouterSource } from './pricing/pricing-sources';
export type { LookupModelPricingOptions, ModelPricing, PricingEntry, PricingSource, PricingSourceId } from './pricing/pricing-types';
export { createDefaultSettings, DEFAULT_CONCURRENCY } from './project/default-settings';
export { type LoadProjectOptions, loadProjectFile, REASONING_LEVELS, saveProjectFile, validateProjectState } from './project/project-file';
export { createProvider, type ProviderOptions } from './providers/create-provider';
export { ProviderError } from './providers/provider-http';
export { getProviderPreset, PROVIDER_PRESETS } from './providers/provider-presets';
export { estimateCost, priceEstimate } from './translate/estimate-cost';
export type { GeneratedGuide, GenerateGuideOptions, GuidePhase, GuideProgress } from './translate/generate-guide';
export { generateGuide } from './translate/generate-guide';
export {
  composeGuideline,
  GENERATED_GUIDELINE_END,
  GENERATED_GUIDELINE_HEADING,
  GENERATED_GUIDELINE_START,
  GUIDELINE_SECTIONS,
  type GuidelineSection,
  splitGuideline,
} from './translate/generate-guide-guideline';
export { GUIDELINE_PRESETS, type GuidelinePreset, type GuidelinePresetId, getGuidelinePreset } from './translate/guideline-presets';
export {
  DEFAULT_IDENTICAL_MIN_LETTERS,
  identicalMinLettersOf,
  isIdenticalTranslation,
  MAX_IDENTICAL_MIN_LETTERS,
} from './translate/identical-translation';
export { retranslateSegment } from './translate/retranslate-segment';
export { estimateTokens, languageName } from './translate/token-estimate';
export {
  DEFAULT_MAX_BATCH_SEGMENTS,
  keepsUserEdit,
  MAX_BATCH_SEGMENTS_LIMIT,
  MAX_BATCH_TOKENS,
  MAX_CONCURRENCY,
  makeBatches,
  maxSegmentsOf,
  translateProject,
} from './translate/translate-project';
export {
  DEFAULT_SAMPLE_PASSAGES,
  DEFAULT_SAMPLE_WORDS,
  estimateSampleCost,
  MAX_SAMPLE_PASSAGES,
  randomSampleSeed,
  type SampleRunResult,
  type SampleSelectionOptions,
  selectSamplePassages,
  type TranslateSampleOptions,
  translateSample,
} from './translate/translate-sample';
export { addUsage, cachePriceRatios, MAX_CACHED_INPUT_RATIO, type UsagePricing, usageCostUsd } from './translate/usage-cost';
export type * from './types';
export { randomId } from './util/random-id';
export { REDACTED, redactSecrets } from './util/redact-secrets';
export { lemmatizeEnglish } from './word-hints/english-lemmatizer';
export { estimateWordHintsCost, type WordHintsEstimate } from './word-hints/estimate-word-hints-cost';
export {
  type FrequencyList,
  parseFrequencyList,
  UNLISTED_RANK,
  WORD_FREQUENCY_ATTRIBUTION,
  WORD_HINT_LANGUAGES,
  type WordHintLanguage,
  wordHintLanguage,
} from './word-hints/frequency-list';
export {
  type GenerateWordHintsOptions,
  type GenerateWordHintsResult,
  GLOSS_BATCH_SIZE,
  generateWordHints,
  type WordHintProgress,
} from './word-hints/generate-word-hints';
export {
  clampHintLevel,
  DEFAULT_HINT_LEVEL,
  defaultWordHintSettings,
  glossLanguageOf,
  HINT_LEVEL_CEFR,
  hintRankThreshold,
  MAX_HINT_LEVEL,
  MAX_HINTS_PER_CHAPTER_LIMIT,
  MAX_HINTS_PER_PARAGRAPH_LIMIT,
  MIN_HINT_LEVEL,
  WORD_HINT_STYLES,
  wordHintSettingsOf,
} from './word-hints/hint-levels';
export { type HintCandidate, type HintCandidateOccurrence, hintContext, selectHintCandidates } from './word-hints/select-hint-candidates';
export { type GenerateProjectWordHintsOptions, generateProjectWordHints, planWordHints, type WordHintsPlan } from './word-hints/word-hints-state';
