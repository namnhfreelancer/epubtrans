import { isAbortError, ProviderError } from '../providers/provider-http';

export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;

export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Delay before the next attempt: server Retry-After when given, else exponential backoff with jitter. */
export function retryDelay(err: unknown, attempt: number, random: () => number = Math.random): number {
  if (err instanceof ProviderError && err.retryAfterMs !== undefined) return Math.min(err.retryAfterMs, 5 * MAX_DELAY_MS);
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

const isRetryable = (err: unknown) => err instanceof ProviderError && err.retryable;

/**
 * Runs `fn` up to MAX_ATTEMPTS times, retrying 429/5xx/network failures.
 * Non-retryable errors and aborts propagate immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw signal?.aborted ? abortError(signal) : err;
      if (!isRetryable(err) || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(retryDelay(err, attempt), signal);
    }
  }
}
