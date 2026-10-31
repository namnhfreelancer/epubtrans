/** Locale-aware number, money and duration formatting for the UI. */
export const formatNumber = (n: number, locale: string): string => new Intl.NumberFormat(locale).format(n);

/** US dollars in the UI locale's notation (prices are always USD), with sub-cent precision for small amounts. */
export const formatUsd = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);

/** Short duration such as "45 sec", "12 min", "1 hr 5 min". */
export function formatDuration(ms: number, locale: string): string {
  const unit = (value: number, u: 'second' | 'minute' | 'hour') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value);
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return unit(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}` : unit(hours, 'hour');
}

/** Parses an optional non-negative number input; empty or invalid input yields undefined. */
export function parseOptionalPrice(input: string): number | undefined {
  const value = Number(input.replace(',', '.'));
  return input.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Book- or agent-supplied text placed in a confirm dialog: control, line-break and bidi-override characters become
 * spaces (so a title cannot lay out fake lines or reorder the question), whitespace is collapsed, and the result is
 * clipped to `max` characters with an ellipsis.
 */
export function dialogText(value: string, max: number): string {
  const flat = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is removed here.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('')}…` : flat;
}
