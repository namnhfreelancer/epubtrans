import type { ProjectSettings, WordHintSettings, WordHintStyle } from '../types';

export const MIN_HINT_LEVEL = 1;
export const MAX_HINT_LEVEL = 5;
export const DEFAULT_HINT_LEVEL = 3;
export const MAX_HINTS_PER_PARAGRAPH_LIMIT = 50;
export const MAX_HINTS_PER_CHAPTER_LIMIT = 50;
export const WORD_HINT_STYLES: readonly WordHintStyle[] = ['ruby', 'inline'];

/**
 * Level → the most frequent words that never get a hint. A word gets a hint when its frequency rank is above the
 * threshold. Ranks count word forms, not word families, so they run higher than vocabulary-size estimates.
 */
const RANK_THRESHOLDS: Record<number, number> = { 1: 25_000, 2: 15_000, 3: 9_000, 4: 5_000, 5: 2_500 };

/**
 * Approximate CEFR reader level per hint level: hints cover words a reader at that level probably does not know yet.
 * There is no open full A1–C2 word list, so these labels are rough frequency bands, not certified levels.
 */
export const HINT_LEVEL_CEFR: Record<number, string> = { 1: 'C2', 2: 'C1', 3: 'B2', 4: 'B1', 5: 'A2' };

export function clampHintLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(MAX_HINT_LEVEL, Math.max(MIN_HINT_LEVEL, Math.round(level))) : DEFAULT_HINT_LEVEL;
}

/** Words with a rank at or below this number are too common for a hint at `level`. */
export function hintRankThreshold(level: number): number {
  return RANK_THRESHOLDS[clampHintLevel(level)] as number;
}

export function defaultWordHintSettings(overrides: Partial<WordHintSettings> = {}): WordHintSettings {
  return { enabled: false, level: DEFAULT_HINT_LEVEL, style: 'ruby', maxPerParagraph: 3, perChapter: 1, ...overrides };
}

/** The book's hint settings, defaults filled in. */
export function wordHintSettingsOf(settings: Pick<ProjectSettings, 'wordHints'>): WordHintSettings {
  return defaultWordHintSettings(settings.wordHints);
}

/** Gloss language actually used: the configured one, else the book's target language. */
export function glossLanguageOf(settings: Pick<ProjectSettings, 'wordHints' | 'targetLang'>): string {
  return settings.wordHints?.glossLang?.trim() || settings.targetLang;
}
