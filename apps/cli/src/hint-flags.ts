import {
  type ExportMode,
  MAX_HINT_LEVEL,
  MAX_HINTS_PER_CHAPTER_LIMIT,
  MAX_HINTS_PER_PARAGRAPH_LIMIT,
  MIN_HINT_LEVEL,
  type Project,
  type ProjectSettings,
  WORD_HINT_STYLES,
  type WordHintSettings,
  type WordHintStyle,
  wordHintSettingsOf,
} from '@epubtrans/core';
import { UsageError } from './args';
import type { WordWiseFlagValues } from './flag-specs';
import { parseLanguage } from './settings';

interface HintOptionValues {
  level?: number;
  style?: string;
  perParagraph?: number;
  perChapter?: number;
}

/** Flag names used in error messages (they differ between `hints` and the export commands). */
interface HintOptionNames {
  level: string;
  style: string;
}

function integerIn(name: string, value: number | undefined, min: number, max: number): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
    throw new UsageError(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

/** Validates hint options and applies the given ones over the current hint settings. */
function applyHintOptions(current: WordHintSettings, values: HintOptionValues, names: HintOptionNames): WordHintSettings {
  const level = integerIn(names.level, values.level, MIN_HINT_LEVEL, MAX_HINT_LEVEL);
  const perParagraph = integerIn('--hints-per-paragraph', values.perParagraph, 0, MAX_HINTS_PER_PARAGRAPH_LIMIT);
  const perChapter = integerIn('--hints-per-chapter', values.perChapter, 0, MAX_HINTS_PER_CHAPTER_LIMIT);
  if (values.style !== undefined && !(WORD_HINT_STYLES as readonly string[]).includes(values.style)) {
    throw new UsageError(`${names.style} must be one of: ${WORD_HINT_STYLES.join(', ')}`);
  }
  return {
    ...current,
    ...(level !== undefined ? { level } : {}),
    ...(values.style !== undefined ? { style: values.style as WordHintStyle } : {}),
    ...(perParagraph !== undefined ? { maxPerParagraph: perParagraph } : {}),
    ...(perChapter !== undefined ? { perChapter } : {}),
  };
}

/**
 * `--word-wise` and the hint options of translate, resume and export: `--word-wise` turns hints on for the export,
 * the other flags change style, level and density over the project's settings. Without any of them the settings
 * are returned unchanged.
 */
export function applyWordWiseFlags(settings: ProjectSettings, flags: WordWiseFlagValues): ProjectSettings {
  const values: HintOptionValues = {
    level: flags['hint-level'],
    style: flags['hint-style'],
    perParagraph: flags['hints-per-paragraph'],
    perChapter: flags['hints-per-chapter'],
  };
  if (!flags['word-wise'] && Object.values(values).every((v) => v === undefined)) return settings;
  const current = wordHintSettingsOf(settings);
  const next = applyHintOptions(current, values, { level: '--hint-level', style: '--hint-style' });
  return { ...settings, wordHints: { ...next, enabled: current.enabled || flags['word-wise'] === true } };
}

/** Options of the `hints` command: always enables hints for the book, then applies level, gloss language, style and density. */
export function applyHintsCommandFlags(
  settings: ProjectSettings,
  flags: { level?: number; 'gloss-lang'?: string; style?: string; 'hints-per-paragraph'?: number; 'hints-per-chapter'?: number },
): ProjectSettings {
  const next = applyHintOptions(
    wordHintSettingsOf(settings),
    { level: flags.level, style: flags.style, perParagraph: flags['hints-per-paragraph'], perChapter: flags['hints-per-chapter'] },
    { level: '--level', style: '--style' },
  );
  const gloss = flags['gloss-lang'] === undefined ? next.glossLang : parseLanguage(flags['gloss-lang'], '--gloss-lang');
  const { glossLang: _old, ...rest } = next;
  return { ...settings, wordHints: { ...rest, enabled: true, ...(gloss && gloss !== settings.targetLang ? { glossLang: gloss } : {}) } };
}

/** A note for an export with hints enabled that will carry none (nothing generated, or a mode without the original text). */
export function wordWiseExportNote(project: Project, settings: ProjectSettings, mode: ExportMode, projectPath: string): string | undefined {
  if (!wordHintSettingsOf(settings).enabled) return undefined;
  if (mode === 'translation-only') return 'Note: translation-only has no original text, so this EPUB has no Word Wise hints.\n';
  if (!project.wordHints?.entries.length)
    return `Note: no Word Wise hints were generated for this book yet. Generate them with: epubtrans hints ${projectPath}\n`;
  return undefined;
}
