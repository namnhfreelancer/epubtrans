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
