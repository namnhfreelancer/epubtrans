/**
 * Removes API keys and other credentials from text that may be stored, shared or printed (provider
 * error messages end up in `Segment.error`, `.epubtrans` files, CLI output and the UI).
 */
export const REDACTED = '[redacted]';

/** Runs of a known key shorter than this are too common in ordinary text to redact. */
const MIN_PARTIAL_LENGTH = 8;
/** Keys shorter than this (placeholder keys of local servers) are not redacted, that would mangle the message. */
const MIN_EXACT_LENGTH = 6;

const TOKEN_CHARS = 'A-Za-z0-9_+/=.~-';

/** Secret shapes. A `keep` pattern keeps capture group 1 (the field name) and redacts the rest of the match. */
const SECRET_PATTERNS: { re: RegExp; keep?: boolean }[] = [
  // OpenAI, Anthropic (sk-ant-), OpenRouter (sk-or-) and look-alikes; `*` covers keys the provider already masked.
  { re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_*-]{8,}/g },
  // Google API keys.
  { re: /(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{16,}/g },
  // Authorization header value, with or without a scheme.
  { re: /((?:proxy-)?authorization["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|token)\s+[^\s"',;&]+|[^\s"',;&]{8,})/gi, keep: true },
  // Standalone bearer credentials.
  { re: /(\bbearer\s+)[A-Za-z0-9._~+/=*-]{8,}/gi, keep: true },
  // Key headers, as echoed in header dumps or JSON: x-api-key: v, "api-key": "v".
  { re: /((?<![A-Za-z0-9])(?:x-)?api[_-]?key["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, keep: true },
  // Query parameters: ?key=v, &api_key=v, access_token=v.
  { re: /((?<![A-Za-z0-9_-])(?:x-)?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|key)=)[^\s&"'#]+/gi, keep: true },
  // "key"/"token"/"secret" followed by a long token that has a digit: base64 or hex material in prose.
  {
    re: new RegExp(
      `(\\b(?:api[_ -]?key|access[_ -]?token|token|secret|key)\\b(?:\\s+(?:provided|is|was))?[\\s"':=]+)(?=[${TOKEN_CHARS}]{20,})(?=[A-Za-z_+/=.~-]*\\d)[${TOKEN_CHARS}]+`,
      'gi',
    ),
    keep: true,
  },
];

/** Non-overlapping spans of `text` equal to `secret` or, for a long secret, to a run of at least MIN_PARTIAL_LENGTH of its characters. */
function secretSpans(text: string, secret: string): [number, number][] {
  const spans: [number, number][] = [];
  if (secret.length < MIN_PARTIAL_LENGTH) {
    for (let at = text.indexOf(secret); at !== -1; at = text.indexOf(secret, at + secret.length)) spans.push([at, at + secret.length]);
    return spans;
  }
  const grams = new Map<string, number[]>();
  for (let k = 0; k + MIN_PARTIAL_LENGTH <= secret.length; k++) {
    const gram = secret.slice(k, k + MIN_PARTIAL_LENGTH);
    grams.set(gram, [...(grams.get(gram) ?? []), k]);
  }
  for (let i = 0; i + MIN_PARTIAL_LENGTH <= text.length; ) {
    const starts = grams.get(text.slice(i, i + MIN_PARTIAL_LENGTH));
    if (!starts) {
      i++;
      continue;
    }
    // Extend the match as far as any occurrence of the gram in the secret agrees with the text.
    let longest = MIN_PARTIAL_LENGTH;
    for (const k of starts) {
      let n = MIN_PARTIAL_LENGTH;
      while (k + n < secret.length && i + n < text.length && secret[k + n] === text[i + n]) n++;
      longest = Math.max(longest, n);
    }
    spans.push([i, i + longest]);
    i += longest;
  }
  return spans;
}

function replaceSpans(text: string, spans: [number, number][]): string {
  let out = '';
  let at = 0;
  for (const [from, to] of spans) {
    out += text.slice(at, from) + REDACTED;
    at = to;
  }
  return out + text.slice(at);
}

/** A secret as it may be echoed: raw, URL-encoded or JSON-escaped. */
function echoForms(secret: string): string[] {
  return [...new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])].filter((f) => f.length >= MIN_EXACT_LENGTH);
}

/**
 * Redacts `secrets` (the exact values, and any run of at least 8 characters of one) and common credential
 * shapes: provider key prefixes, bearer tokens, key headers and query parameters, long tokens after "key".
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  // Longest first, so a key that contains another one is removed as a whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    for (const form of echoForms(secret)) {
      const spans = secretSpans(out, form);
      if (spans.length) out = replaceSpans(out, spans);
    }
  }
  for (const { re, keep } of SECRET_PATTERNS) out = out.replace(re, keep ? `$1${REDACTED}` : REDACTED);
  return out;
}
