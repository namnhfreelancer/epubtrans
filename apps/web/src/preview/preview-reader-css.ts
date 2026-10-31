import { PREVIEW_ERROR_CLASS, PREVIEW_PENDING_CLASS, PREVIEW_SEGMENT_ATTR } from '@epubtrans/core';
import type { PreviewSettings, PreviewTheme } from './preview-settings';

const THEME_COLORS: Record<PreviewTheme, { background: string; text: string; link: string }> = {
  light: { background: '#ffffff', text: '#1c1917', link: '#0f766e' },
  sepia: { background: '#f4ecd8', text: '#5b4636', link: '#8a5a2b' },
  dark: { background: '#121212', text: '#e7e5e4', link: '#5eead4' },
};

/** CSS string literal: escapes what could end the string or the rule. */
const cssString = (text: string) => `"${text.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;

/**
 * Reader stylesheet injected by foliate into each rendered section (`renderer.setStyles`). Preview-only: it is never
 * written into an export. Theme and font size override the book; issue highlights mark the preview build's
 * `et-error` segments (outline and badge) and `et-pending` ones (a subtle dashed outline).
 */
export function previewReaderCss(settings: Pick<PreviewSettings, 'theme' | 'fontScale' | 'showIssues'>, errorBadge: string): string {
  const colors = THEME_COLORS[settings.theme];
  const rules = [
    `html { color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; font-size: ${settings.fontScale}% !important; }`,
    `html, body { background: ${colors.background} !important; color: ${colors.text} !important; }`,
    `a:any-link { color: ${colors.link} !important; }`,
    `[${PREVIEW_SEGMENT_ATTR}] { cursor: pointer; }`,
    `[${PREVIEW_SEGMENT_ATTR}]:hover { outline: 1px dotted ${colors.link}; outline-offset: 2px; }`,
  ];
  if (settings.showIssues) {
    rules.push(
      `.${PREVIEW_ERROR_CLASS} { outline: 2px solid #dc2626 !important; outline-offset: 2px; background-color: rgba(220, 38, 38, 0.1) !important; }`,
      `.${PREVIEW_ERROR_CLASS}::before { content: ${cssString(errorBadge)}; float: inline-end; margin-inline-start: 0.5em; padding: 0 0.5em; border-radius: 999px; background: #dc2626; color: #fff; font: 600 0.7rem/1.5 system-ui, sans-serif; text-indent: 0; }`,
      `.${PREVIEW_PENDING_CLASS} { outline: 1px dashed rgba(217, 119, 6, 0.75) !important; outline-offset: 2px; }`,
    );
  }
  return rules.join('\n');
}
