/**
 * Tool outputs: always a JSON object string with `ok`, at most {@link MAX_OUTPUT_CHARS} characters, with every secret
 * (stored API keys) redacted. Text from books, models and providers goes into named fields as plain, clipped text.
 */

/** Per-call output budget recommended for WebMCP agents. */
export const MAX_OUTPUT_CHARS = 1500;
/** Room kept for the `truncated` note when a list is shortened to fit. */
const LIST_BUDGET = MAX_OUTPUT_CHARS - 120;
const REDACTED = '[redacted]';
/** Shorter strings are too likely to occur in ordinary text to be redacted safely (real keys are much longer). */
const MIN_SECRET_LENGTH = 8;

export type ToolSuccess = { ok: true } & Record<string, unknown>;
export type ToolFailure = { ok: false; error: string; hint?: string };
export type ToolResult = ToolSuccess | ToolFailure;

/** A success result; `ok` comes first in the JSON and cannot be overridden by `data`. */
export const ok = (data: Record<string, unknown> = {}): ToolSuccess => Object.assign({ ok: true as const }, data, { ok: true as const });

export const fail = (error: string, hint?: string): ToolFailure => (hint ? { ok: false, error, hint } : { ok: false, error });

/** Clips text to `max` characters, marking the cut with an ellipsis. */
export function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of a segment's inline markup (tags dropped, common entities decoded, whitespace collapsed). */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<br\s*\/?>/gi, ' ')
      // Segment markup is inline formatting: dropping the tags keeps words and punctuation together.
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
        if (name[0] === '#') {
          const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
          return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[name.toLowerCase()] ?? match;
      })
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Clipped plain text of untrusted markup or text. */
export const untrustedText = (value: string | undefined, max: number): string => clip(htmlToText(value ?? ''), max);

/**
 * Builds a result around as many leading `items` as fit the output budget. When items had to be dropped the result
 * says so (`truncated`, `note`), so the agent can page or narrow its request.
 */
export function fitList<T>(items: readonly T[], build: (items: readonly T[]) => ToolSuccess): ToolSuccess {
  let count = items.length;
  let result = build(items);
  while (count > 0 && JSON.stringify(result).length > LIST_BUDGET) {
    count = Math.max(0, Math.min(count - 1, Math.floor(count * 0.8)));
    result = { ...build(items.slice(0, count)), truncated: true, note: `Only ${count} of ${items.length} items fit the output limit.` };
  }
  return result;
}

function redact(json: string, secrets: readonly string[]): string {
  let out = json;
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    // The raw value and its JSON-escaped form (a key with quotes or backslashes would appear escaped).
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) out = out.split(form).join(REDACTED);
  }
  return out;
}

/**
 * Serializes a result for the agent: redacts every secret, then enforces the output budget. Output that is still too
 * long is replaced by a valid JSON object carrying its beginning as a string, flagged `truncated`.
 */
export function serializeResult(result: ToolResult, secrets: readonly string[]): string {
  const json = redact(JSON.stringify(result), secrets);
  if (json.length <= MAX_OUTPUT_CHARS) return json;
  const note = 'Output exceeded 1500 characters and was cut; request fewer items or a narrower range.';
  let keep = MAX_OUTPUT_CHARS - 200;
  for (;;) {
    const cut = JSON.stringify({ ok: result.ok, truncated: true, note, partial: json.slice(0, Math.max(0, keep)) });
    if (cut.length <= MAX_OUTPUT_CHARS || keep <= 0) return cut;
    keep -= cut.length - MAX_OUTPUT_CHARS + 10;
  }
}
