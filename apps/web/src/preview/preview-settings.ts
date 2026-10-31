import { EXPORT_MODES, type ExportMode } from '@epubtrans/core';
import { browserStorage, isPlainObject, type KeyValueStorage, readJson, writeString } from '../lib/safe-storage';

/**
 * Preview-only reader settings. They live in localStorage and become reader CSS / layout attributes on the
 * preview's foliate view; they are never part of the project or of an exported file.
 */
export type DeviceId = 'kindle' | 'phone' | 'tablet' | 'desktop';
export type PreviewTheme = 'light' | 'sepia' | 'dark';
export type PreviewFlow = 'paginated' | 'scrolled';

export interface DevicePreset {
  id: DeviceId;
  /** Viewport in CSS pixels; undefined = fluid (fills the available width). */
  width?: number;
  height?: number;
  /** foliate paginator layout: header/footer margin (px), column gap (%), widest column (px), most columns. */
  margin: number;
  gap: number;
  maxInlineSize: number;
  maxColumnCount: number;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  // Kindle Paperwhite 6.8" (1236×1648 px at 300 ppi), shown at a third of its pixel size.
  { id: 'kindle', width: 412, height: 549, margin: 28, gap: 6, maxInlineSize: 720, maxColumnCount: 1 },
  { id: 'phone', width: 390, height: 844, margin: 32, gap: 5, maxInlineSize: 720, maxColumnCount: 1 },
  { id: 'tablet', width: 820, height: 1180, margin: 44, gap: 6, maxInlineSize: 720, maxColumnCount: 1 },
  { id: 'desktop', margin: 48, gap: 7, maxInlineSize: 720, maxColumnCount: 2 },
];
export const PREVIEW_THEMES: readonly PreviewTheme[] = ['light', 'sepia', 'dark'];
export const PREVIEW_FLOWS: readonly PreviewFlow[] = ['paginated', 'scrolled'];
export const FONT_SCALE_MIN = 70;
export const FONT_SCALE_MAX = 200;
export const FONT_SCALE_STEP = 10;

export interface PreviewSettings {
  device: DeviceId;
  theme: PreviewTheme;
  flow: PreviewFlow;
  /** Font size in percent of the book's own size. */
  fontScale: number;
  /** Highlight failed and untranslated segments. */
  showIssues: boolean;
  mode: ExportMode;
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  device: 'kindle',
  theme: 'light',
  flow: 'paginated',
  fontScale: 100,
  showIssues: true,
  mode: 'bilingual',
};

const STORAGE_KEY = 'epubtrans:preview-settings';

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => allowed.find((a) => a === value) ?? fallback;

export const clampFontScale = (value: number): number =>
  Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP));

export function devicePreset(id: DeviceId): DevicePreset {
  return DEVICE_PRESETS.find((d) => d.id === id) ?? (DEVICE_PRESETS[0] as DevicePreset);
}

/** Validates stored settings field by field; unknown or corrupt values fall back to the defaults. */
export function validatePreviewSettings(value: unknown): PreviewSettings | undefined {
  if (!isPlainObject(value)) return undefined;
  const d = DEFAULT_PREVIEW_SETTINGS;
  return {
    device: pick(
      DEVICE_PRESETS.map((p) => p.id),
      value.device,
      d.device,
    ),
    theme: pick(PREVIEW_THEMES, value.theme, d.theme),
    flow: pick(PREVIEW_FLOWS, value.flow, d.flow),
    fontScale: typeof value.fontScale === 'number' && Number.isFinite(value.fontScale) ? clampFontScale(value.fontScale) : d.fontScale,
    showIssues: typeof value.showIssues === 'boolean' ? value.showIssues : d.showIssues,
    mode: pick(EXPORT_MODES, value.mode, d.mode),
  };
}

export function loadPreviewSettings(storage: KeyValueStorage | undefined = browserStorage()): PreviewSettings {
  return readJson(storage, STORAGE_KEY, validatePreviewSettings, DEFAULT_PREVIEW_SETTINGS);
}

export function savePreviewSettings(settings: PreviewSettings, storage: KeyValueStorage | undefined = browserStorage()): void {
  writeString(storage, STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Size of the device frame: the preset's aspect ratio, shrunk to fit the available area (never enlarged).
 * Fluid presets fill the width at the available height.
 */
export function fitDevice(preset: DevicePreset, availableWidth: number, availableHeight: number): { width: number; height: number } {
  const maxW = Math.max(0, Math.floor(availableWidth));
  const maxH = Math.max(0, Math.floor(availableHeight));
  if (!preset.width || !preset.height) return { width: maxW, height: maxH };
  const scale = Math.min(1, maxW / preset.width, maxH / preset.height);
  return { width: Math.floor(preset.width * scale), height: Math.floor(preset.height * scale) };
}
