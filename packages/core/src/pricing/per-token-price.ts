/**
 * Converts a per-token USD price (a number or a numeric string, as OpenRouter and LiteLLM publish it)
 * into USD per 1M tokens. Negative, missing or non-numeric values (OpenRouter uses "-1" for routers) yield undefined.
 */
export function perTokenToPerM(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const perToken = Number(value);
  if (!Number.isFinite(perToken) || perToken < 0) return undefined;
  return Math.round(perToken * 1e6 * 1e6) / 1e6;
}
