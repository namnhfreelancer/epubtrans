import type { ExportFontId } from '../types';

/**
 * Bundled fonts that an export can embed. The files live in `packages/core/data/fonts/` (TrueType subsets covering
 * Latin, Latin Extended and Vietnamese, rebuilt by `scripts/subset-embedded-fonts.py` from the official Google Fonts
 * sources). All are licensed under the SIL Open Font License 1.1 without Reserved Font Names, which allows bundling,
 * subsetting and embedding in documents; the family's license file travels inside every EPUB that embeds it. Fonts are
 * never obfuscated. The web app fetches the files lazily from its own origin; the CLI embeds them in its binary.
 */
export interface EmbeddedFontFace {
  /** File name in `data/fonts/` (also the name inside the EPUB). */
  file: string;
  weight: 400 | 700;
  style: 'normal' | 'italic';
  /** Exact file size (checked by a test), used to show the added size before export. */
  bytes: number;
}

export interface EmbeddedFont {
  id: Exclude<ExportFontId, GenericFontId>;
  /** CSS family name declared by the generated `@font-face` rules. */
  family: string;
  /** Fallback generic family when the reader ignores embedded fonts. */
  generic: 'serif' | 'sans-serif';
  /** Regular, italic and bold; readers synthesize bold italic. */
  faces: readonly EmbeddedFontFace[];
  licenseFile: string;
  licenseBytes: number;
}

export type GenericFontId = 'serif' | 'sans-serif' | 'monospace';
export const GENERIC_FONTS: readonly GenericFontId[] = ['serif', 'sans-serif', 'monospace'];

const faces = (prefix: string, regular: number, italic: number, bold: number): EmbeddedFontFace[] => [
  { file: `${prefix}-regular.ttf`, weight: 400, style: 'normal', bytes: regular },
  { file: `${prefix}-italic.ttf`, weight: 400, style: 'italic', bytes: italic },
  { file: `${prefix}-bold.ttf`, weight: 700, style: 'normal', bytes: bold },
];

export const EMBEDDED_FONTS: readonly EmbeddedFont[] = [
  {
    id: 'literata',
    family: 'Literata',
    generic: 'serif',
    faces: faces('literata', 95_372, 94_920, 98_100),
    licenseFile: 'literata-OFL.txt',
    licenseBytes: 4_389,
  },
  {
    id: 'noto-serif',
    family: 'Noto Serif',
    generic: 'serif',
    faces: faces('noto-serif', 155_240, 166_408, 155_520),
    licenseFile: 'noto-serif-OFL.txt',
    licenseBytes: 4_396,
  },
  {
    id: 'be-vietnam-pro',
    family: 'Be Vietnam Pro',
    generic: 'sans-serif',
    faces: faces('be-vietnam-pro', 66_456, 68_148, 66_268),
    licenseFile: 'be-vietnam-pro-OFL.txt',
    licenseBytes: 4_397,
  },
  {
    id: 'noto-sans',
    family: 'Noto Sans',
    generic: 'sans-serif',
    faces: faces('noto-sans', 131_488, 138_288, 131_988),
    licenseFile: 'noto-sans-OFL.txt',
    licenseBytes: 4_396,
  },
];

/** Every font choice a style may name: the generic families, then the bundled fonts. */
export const EXPORT_FONT_IDS: readonly ExportFontId[] = [...GENERIC_FONTS, ...EMBEDDED_FONTS.map((f) => f.id)];

export const embeddedFont = (id: ExportFontId | undefined): EmbeddedFont | undefined => EMBEDDED_FONTS.find((f) => f.id === id);

/** Every file name of the bundle (fonts and licenses): the only names a font loader is ever asked for. */
export const EMBEDDED_FONT_FILES: readonly string[] = EMBEDDED_FONTS.flatMap((f) => [...f.faces.map((face) => face.file), f.licenseFile]);

/** Bytes the given fonts add to an EPUB before zip compression (font files plus license files). */
export function embeddedFontsSize(fonts: readonly EmbeddedFont[]): number {
  return fonts.reduce((sum, f) => sum + f.licenseBytes + f.faces.reduce((s, face) => s + face.bytes, 0), 0);
}

/**
 * Reads one bundled file by name (see {@link EMBEDDED_FONT_FILES}): the web app fetches it from its own origin, the CLI
 * reads it from its binary. Export rejects bytes that are not a TrueType font or a plain-text license.
 */
export type FontFileLoader = (file: string) => Promise<Uint8Array>;
