import type { ExportStyle, ExportStylePresetId } from '../types';
import { DEFAULT_SOURCE_OPACITY } from './export-style-css';

/**
 * Ready-made export styles. None sets a background or a color that only works on one theme: the one accent color
 * (Learner hints, #1f7a8c) keeps a contrast of about 4–5:1 on both white and black pages.
 */
const PRESETS: Record<ExportStylePresetId, Omit<ExportStyle, 'preset'>> = {
  /** The default look: the original text faded behind the translation. */
  classic: { source: { opacity: DEFAULT_SOURCE_OPACITY } },
  /** For language learners: the original at full strength, prominent hints, a smaller translation. */
  learner: { source: { opacity: 1 }, translation: { fontSizePercent: 90 }, hint: { color: '#1f7a8c', fontSizePercent: 65 } },
  /** No faded text; the translation in bold. */
  'high-contrast': { source: { opacity: 1 }, translation: { fontWeight: 'bold' }, hint: { fontSizePercent: 65 } },
  /** The translation slightly larger, the original small, italic and faded. */
  'translation-emphasis': { source: { opacity: 0.45, fontSizePercent: 85, italic: true }, translation: { fontSizePercent: 105 } },
  /** Both texts look like the book's own text. */
  minimal: { source: { opacity: 1 } },
};

export function exportStylePreset(id: ExportStylePresetId): ExportStyle {
  return { preset: id, ...structuredClone(PRESETS[id]) };
}

/** Canonical JSON of a style without its preset label, for comparing looks. */
function lookKey(style: ExportStyle | undefined): string {
  const { preset: _preset, ...look } = style ?? {};
  const sort = (v: unknown): unknown =>
    typeof v === 'object' && v !== null
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, sort(x)]),
        )
      : v;
  return JSON.stringify(sort(look));
}

/**
 * True when two styles produce the same look (preset labels ignored). A missing source opacity means the default fade,
 * so an absent or empty style equals Classic.
 */
export function sameExportStyle(a: ExportStyle | undefined, b: ExportStyle | undefined): boolean {
  const norm = (s: ExportStyle | undefined): ExportStyle => ({ ...s, source: { opacity: DEFAULT_SOURCE_OPACITY, ...s?.source } });
  return lookKey(norm(a)) === lookKey(norm(b));
}

/** The preset whose look the style has, if any. */
export function matchingPreset(style: ExportStyle | undefined): ExportStylePresetId | undefined {
  return (Object.keys(PRESETS) as ExportStylePresetId[]).find((id) => sameExportStyle(style, exportStylePreset(id)));
}
