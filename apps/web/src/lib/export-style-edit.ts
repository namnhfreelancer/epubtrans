import {
  type ExportFontId,
  type ExportFontWeight,
  type ExportStyle,
  type HintBlockStyle,
  type SourceBlockStyle,
  type TranslationBlockStyle,
  validateExportStyle,
} from '@epubtrans/core';

/** Choices offered by the style editor; every value lies inside core's validated ranges. */
export const STYLE_CHOICES = {
  opacity: [0.3, 0.4, 0.45, 0.55, 0.7, 0.85, 1],
  blockSize: [70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 130, 140, 150],
  hintSize: [40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100],
  spacing: [0, 0.25, 0.5, 0.75, 1, 1.5, 2],
  weight: ['normal', 'bold', 300, 500, 600] as ExportFontWeight[],
} as const;

/** Default color offered when a custom color is switched on (the reader's own color stays the default). */
export const DEFAULT_PICKER_COLOR = '#555555';

type Groups = { source: SourceBlockStyle; translation: TranslationBlockStyle; hint: HintBlockStyle };

/**
 * The style with one field of a block changed (`undefined` removes it, so it inherits again). An edit makes the style
 * custom (the preset label is dropped), empty groups disappear, and the result is validated like any stored style.
 */
export function patchStyleGroup<G extends keyof Groups, K extends keyof Groups[G]>(
  style: ExportStyle | undefined,
  group: G,
  field: K,
  value: Groups[G][K] | undefined,
): ExportStyle {
  const { preset: _preset, ...rest } = style ?? {};
  const nextGroup: Record<string, unknown> = { ...(rest[group] ?? {}) };
  if (value === undefined) delete nextGroup[field as string];
  else nextGroup[field as string] = value;
  return validateExportStyle({ ...rest, [group]: Object.keys(nextGroup).length > 0 ? nextGroup : undefined });
}

/** The style with a new block spacing (`undefined`: the book's own spacing). */
export function patchBlockSpacing(style: ExportStyle | undefined, value: number | undefined): ExportStyle {
  const { preset: _preset, blockSpacingEm: _old, ...rest } = style ?? {};
  return validateExportStyle(value === undefined ? rest : { ...rest, blockSpacingEm: value });
}

/** A `<select>` value back to a number, `''` meaning "not set". */
export const optionalNumber = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));

/** A weight `<select>` value back to a weight: numeric weights are numbers, `''` means "not set". */
export const optionalWeight = (raw: string): ExportFontWeight | undefined =>
  raw === '' ? undefined : raw === 'normal' || raw === 'bold' ? raw : (Number(raw) as ExportFontWeight);

export const optionalFont = (raw: string): ExportFontId | undefined => (raw === '' ? undefined : (raw as ExportFontId));

/** File size for people: "288 KB", "1.2 MB". */
export function formatByteSize(bytes: number, locale: string): string {
  const mb = bytes >= 1_000_000;
  const value = mb ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mb ? 1 : 0 }).format(value)} ${mb ? 'MB' : 'KB'}`;
}

/**
 * The editor's choices plus the current value when it is not one of them (a template, a project file or the CLI may
 * set any valid value, like 113%), so the `<select>` shows that value instead of falling back to "Default". Numbers
 * stay sorted; other values are appended.
 */
export function choicesWith<T extends string | number>(choices: readonly T[], value: T | undefined): readonly T[] {
  if (value === undefined || choices.includes(value)) return choices;
  if (typeof value !== 'number' || choices.some((c) => typeof c !== 'number')) return [...choices, value];
  return [...choices, value].sort((a, b) => (a as number) - (b as number));
}

/** Unknown keys left out of an imported file, for a notice: the first few, then how many more. */
export function ignoredKeysText(keys: readonly string[], max = 6): string {
  const shown = keys.slice(0, max).join(', ');
  return keys.length > max ? `${shown} (+${keys.length - max})` : shown;
}
