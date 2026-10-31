import { SOURCE_CLASS, TRANSLATION_CLASS } from '../export/segment-placement';
import { HINT_INLINE_CLASS, HINT_PARAGRAPH_CLASS, HINT_RUBY_CLASS } from '../export/word-hint-markup';
import type { ExportFontId, ExportMode, ExportStyle } from '../types';
import { EMBEDDED_FONTS, type EmbeddedFont, embeddedFont } from './embedded-fonts';

/** Class of the generated attribution note (see `attribution-page.ts`). */
export const ATTRIBUTION_CLASS = 'et-attr';
/** Folder (next to `epubtrans.css`) that receives embedded font files and their licenses. */
export const FONT_DIR = 'epubtrans-fonts';

/** Default fading of the original text when a style does not set an opacity. */
export const DEFAULT_SOURCE_OPACITY = 0.55;
const DEFAULT_RUBY_SIZE = '0.55em';
const DEFAULT_INLINE_SIZE = '0.8em';

type Declaration = readonly [property: string, value: string | number | undefined];

/** One CSS rule, or nothing when every value is undefined. Values come only from validated styles and constants. */
function rule(selector: string, declarations: readonly Declaration[]): string {
  const body = declarations.filter((d) => d[1] !== undefined).map(([p, v]) => `${p}: ${v};`);
  return body.length > 0 ? `${selector} { ${body.join(' ')} }\n` : '';
}

const percent = (value: number | undefined) => (value === undefined ? undefined : `${value}%`);

/**
 * Marks a value the user chose as `!important`. Books style their paragraphs with selectors like `p.ct`, which outrank
 * the single-class `.et-tr`, so without it a chosen color or size would silently lose to the book's own stylesheet.
 * Defaults stay plain, so a book exported without a style keeps the old stylesheet byte for byte.
 */
const chosen = (value: string | number | undefined) => (value === undefined ? undefined : `${value} !important`);

function fontFamily(id: ExportFontId | undefined): string | undefined {
  if (id === undefined) return undefined;
  const font = embeddedFont(id);
  return font ? `"${font.family}", ${font.generic}` : id;
}

/** The embedded fonts a mode needs: the source font in bilingual layouts, the translation font wherever it shows. */
export function embeddedFontsFor(style: ExportStyle | undefined, mode: ExportMode): EmbeddedFont[] {
  const ids = new Set<ExportFontId>();
  const bilingual = mode === 'bilingual' || mode === 'bilingual-translation-first';
  if (bilingual && style?.source?.font) ids.add(style.source.font);
  if (mode !== 'original' && style?.translation?.font) ids.add(style.translation.font);
  return EMBEDDED_FONTS.filter((f) => ids.has(f.id));
}

/** True when the style changes how the translated text looks (translation-only exports then mark it with the class). */
export function stylesTranslation(style: ExportStyle | undefined): boolean {
  return style?.translation !== undefined || style?.blockSpacingEm !== undefined;
}

function fontFaces(fonts: readonly EmbeddedFont[]): string {
  return fonts
    .flatMap((font) =>
      font.faces.map((face) =>
        rule('@font-face', [
          ['font-family', `"${font.family}"`],
          ['font-style', face.style],
          ['font-weight', face.weight],
          ['src', `url("${FONT_DIR}/${face.file}")`],
        ]),
      ),
    )
    .join('');
}

export interface ExportCssOptions {
  /** Fonts to declare with `@font-face` (their files are packaged next to the stylesheet). */
  fonts: readonly EmbeddedFont[];
  /** The export carries the attribution page. */
  attribution: boolean;
}

/**
 * The generated `epubtrans.css`: the bilingual layout, Word Wise hints, embedded fonts and the attribution note. Without
 * a style it is the default look (the original faded to 0.55). Only CSS 2.1 plus `opacity` and `@font-face` is used, so
 * EPUB 2 readers accept it; no background color is ever set, so reader themes keep working.
 */
export function exportStyleCss(style: ExportStyle | undefined, options: ExportCssOptions): string {
  const src = style?.source;
  const tr = style?.translation;
  const hint = style?.hint;
  const spacing = style?.blockSpacingEm === undefined ? undefined : `${style.blockSpacingEm}em`;
  const hintSize = hint?.fontSizePercent;
  const lineHeight = hintSize === undefined ? 2 : Math.max(2, Math.round((1.4 + hintSize / 100) * 10) / 10);
  return [
    '/* epubtrans: bilingual layout and Word Wise hints */\n',
    fontFaces(options.fonts),
    rule(`.${SOURCE_CLASS}`, [
      ['opacity', src?.opacity === undefined || src.opacity === DEFAULT_SOURCE_OPACITY ? DEFAULT_SOURCE_OPACITY : chosen(src.opacity)],
      ['color', chosen(src?.color)],
      ['font-size', chosen(percent(src?.fontSizePercent))],
      ['font-style', chosen(src?.italic ? 'italic' : undefined)],
      ['font-family', chosen(fontFamily(src?.font))],
    ]),
    rule(`.${TRANSLATION_CLASS}`, [
      ['color', chosen(tr?.color)],
      ['font-family', chosen(fontFamily(tr?.font))],
      ['font-weight', chosen(tr?.fontWeight)],
      ['font-size', chosen(percent(tr?.fontSizePercent))],
    ]),
    rule(`.${SOURCE_CLASS}, .${TRANSLATION_CLASS}`, [
      ['margin-top', chosen(spacing)],
      ['margin-bottom', chosen(spacing)],
    ]),
    rule(`ruby.${HINT_RUBY_CLASS} > rt`, [
      ['font-size', chosen(percent(hintSize)) ?? DEFAULT_RUBY_SIZE],
      ['font-style', 'normal'],
      ['font-weight', 'normal'],
      ['color', chosen(hint?.color)],
    ]),
    rule(`.${HINT_PARAGRAPH_CLASS}`, [['line-height', lineHeight]]),
    rule(`.${HINT_INLINE_CLASS}`, [
      ['font-size', chosen(percent(hintSize)) ?? DEFAULT_INLINE_SIZE],
      ['opacity', 0.75],
      ['color', chosen(hint?.color)],
    ]),
    options.attribution
      ? rule(`.${ATTRIBUTION_CLASS}`, [
          ['margin-top', '30%'],
          ['text-align', 'center'],
          ['font-size', '0.8em'],
        ])
      : '',
  ].join('');
}
