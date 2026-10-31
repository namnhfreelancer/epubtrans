import type { ExportFontId, ExportFontWeight, ExportStyle, ExportStylePresetId, HintBlockStyle, SourceBlockStyle, TranslationBlockStyle } from '../types';
import { EXPORT_FONT_IDS } from './embedded-fonts';

/**
 * Strict validation of untrusted export styles (project files, IndexedDB, template files, `--style-file`, agent input).
 * Unknown keys, wrong types and out-of-range values are rejected with a message naming the field; nothing is clamped.
 * Colors are normalized to `#rrggbb`, so only digits and letters a–f ever reach the stylesheet: a value cannot close a
 * CSS rule, start a comment or reference a URL.
 */
export class ExportStyleError extends Error {
  override readonly name = 'ExportStyleError';
}

export const EXPORT_STYLE_PRESET_IDS: readonly ExportStylePresetId[] = ['classic', 'learner', 'high-contrast', 'translation-emphasis', 'minimal'];
export const EXPORT_FONT_WEIGHTS: readonly ExportFontWeight[] = ['normal', 'bold', 100, 200, 300, 400, 500, 600, 700, 800, 900];

export const STYLE_LIMITS = {
  opacity: { min: 0.2, max: 1 },
  blockFontSizePercent: { min: 50, max: 200 },
  hintFontSizePercent: { min: 30, max: 120 },
  blockSpacingEm: { min: 0, max: 3 },
} as const;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, expected: string): never {
  throw new ExportStyleError(`Invalid export style: ${path} must be ${expected}`);
}

function object(v: unknown, path: string, keys: readonly string[]): Json {
  if (!isObj(v)) fail(path, 'an object');
  for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`${path}.${key.slice(0, 40)}`, `one of the known keys (${keys.join(', ')})`);
  return v;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` (0–255 each) → `#rrggbb`; anything else is undefined. */
export function normalizeColor(value: string): string | undefined {
  const text = value.trim();
  if (text.length > 32) return undefined;
  const hex = HEX.exec(text)?.[1];
  if (hex) return `#${(hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex).toLowerCase()}`;
  const rgb = RGB.exec(text);
  if (!rgb) return undefined;
  const parts = rgb.slice(1, 4).map(Number);
  if (parts.some((n) => n > 255)) return undefined;
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function color(o: Json, key: string, path: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  const normalized = typeof v === 'string' ? normalizeColor(v) : undefined;
  return normalized ?? fail(`${path}.${key}`, 'a color written #rgb, #rrggbb or rgb(r, g, b)');
}

function number(o: Json, key: string, path: string, range: { min: number; max: number }, integer: boolean): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < range.min || v > range.max || (integer && !Number.isInteger(v))) {
    fail(`${path}.${key}`, `${integer ? 'an integer' : 'a number'} from ${range.min} to ${range.max}`);
  }
  return integer ? v : Math.round(v * 100) / 100;
}

function oneOf<T extends string | number>(o: Json, key: string, path: string, allowed: readonly T[]): T | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fail(`${path}.${key}`, `one of ${allowed.join(', ')}`);
}

function bool(o: Json, key: string, path: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  return typeof v === 'boolean' ? v : fail(`${path}.${key}`, 'true or false');
}

/** Drops undefined values; an object left empty becomes undefined. */
function compact<T extends object>(o: T): T | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function sourceStyle(v: unknown, path: string): SourceBlockStyle | undefined {
  const o = object(v, path, ['color', 'opacity', 'fontSizePercent', 'italic', 'font']);
  return compact<SourceBlockStyle>({
    color: color(o, 'color', path),
    opacity: number(o, 'opacity', path, STYLE_LIMITS.opacity, false),
    fontSizePercent: number(o, 'fontSizePercent', path, STYLE_LIMITS.blockFontSizePercent, true),
    italic: bool(o, 'italic', path),
    font: oneOf<ExportFontId>(o, 'font', path, EXPORT_FONT_IDS),
  });
}

function translationStyle(v: unknown, path: string): TranslationBlockStyle | undefined {
  const o = object(v, path, ['color', 'font', 'fontWeight', 'fontSizePercent']);
  return compact<TranslationBlockStyle>({
    color: color(o, 'color', path),
    font: oneOf<ExportFontId>(o, 'font', path, EXPORT_FONT_IDS),
    fontWeight: oneOf<ExportFontWeight>(o, 'fontWeight', path, EXPORT_FONT_WEIGHTS),
    fontSizePercent: number(o, 'fontSizePercent', path, STYLE_LIMITS.blockFontSizePercent, true),
  });
}

function hintStyle(v: unknown, path: string): HintBlockStyle | undefined {
  const o = object(v, path, ['color', 'fontSizePercent']);
  return compact<HintBlockStyle>({
    color: color(o, 'color', path),
    fontSizePercent: number(o, 'fontSizePercent', path, STYLE_LIMITS.hintFontSizePercent, true),
  });
}

/**
 * Validates an untrusted export style and returns a clean copy (colors normalized, empty groups dropped). Throws
 * {@link ExportStyleError} naming the first invalid field. `path` prefixes the field names in messages.
 */
export function validateExportStyle(input: unknown, path = 'style'): ExportStyle {
  const o = object(input, path, ['preset', 'source', 'translation', 'blockSpacingEm', 'hint']);
  const style = compact<ExportStyle>({
    preset: oneOf<ExportStylePresetId>(o, 'preset', path, EXPORT_STYLE_PRESET_IDS),
    source: o.source === undefined ? undefined : sourceStyle(o.source, `${path}.source`),
    translation: o.translation === undefined ? undefined : translationStyle(o.translation, `${path}.translation`),
    blockSpacingEm: number(o, 'blockSpacingEm', path, STYLE_LIMITS.blockSpacingEm, false),
    hint: o.hint === undefined ? undefined : hintStyle(o.hint, `${path}.hint`),
  });
  return style ?? {};
}
