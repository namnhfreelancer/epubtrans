import { redactSecrets } from '../util/redact-secrets';

/**
 * HTTP plumbing shared by provider adapters: JSON requests, error mapping and Retry-After parsing.
 * Error messages are redacted of credential shapes in the constructor, so no adapter can leak a key through one.
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    message: string,
    /** HTTP status; 0 for network failures. */
    readonly status: number,
    /** Server-requested delay before retrying, in milliseconds. */
    readonly retryAfterMs?: number,
  ) {
    super(redactSecrets(message));
  }

  /** Rate limits, overload, server and network errors are worth retrying. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 409 || this.status === 425 || this.status === 429 || this.status >= 500;
  }

  /** Errors that will fail every request (bad key, no access, unknown endpoint/model). */
  get fatal(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Parses `Retry-After` (seconds or HTTP date) and `retry-after-ms`. */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const ms = Number(headers.get('retry-after-ms'));
  if (headers.has('retry-after-ms') && Number.isFinite(ms) && ms >= 0) return ms;
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown; signal?: AbortSignal; secrets?: readonly string[] },
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method,
      headers: init.body === undefined ? init.headers : { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ProviderError(redactSecrets(`Network error calling ${new URL(url).host}: ${(err as Error).message}`, init.secrets), 0);
  }
  const text = await res.text();
  if (!res.ok) {
    const message = `HTTP ${res.status} from ${new URL(url).host}: ${errorMessage(text) || res.statusText}`;
    throw new ProviderError(redactSecrets(message, init.secrets), res.status, parseRetryAfter(res.headers));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(`Invalid JSON response from ${new URL(url).host}`, res.status);
  }
}

function errorMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') return json.error;
    return json.error?.message ?? json.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
