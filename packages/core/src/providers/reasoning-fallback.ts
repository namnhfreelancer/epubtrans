import type { ReasoningLevel } from '../types';
import { ProviderError } from './provider-http';

/**
 * Endpoint, model and level combinations that rejected the reasoning field during this session (page or process
 * lifetime). Requests to them omit the field, so a rejection costs one extra request per session, not one per batch.
 */
const rejected = new Set<string>();

/** Statuses an endpoint answers when it does not know a request field or value. */
const isFieldRejection = (err: unknown) => err instanceof ProviderError && (err.status === 400 || err.status === 422);

/** Whether `level` asks for a request field at all (`default` leaves the provider's behaviour alone). */
export const sendsReasoningField = (level: ReasoningLevel | undefined): level is 'low' | 'off' => level === 'low' || level === 'off';

/**
 * Sends a request with the reasoning field, and when the endpoint answers 400/422 retries once without it. If that retry
 * succeeds, the combination is remembered and later requests omit the field; the rejected attempt never reaches the
 * caller, so it does not count toward the run's consecutive client-error stop. A retry that fails too means the field
 * was not the problem: its error propagates and nothing is remembered.
 */
export async function withReasoningFallback<T>(key: string, level: ReasoningLevel | undefined, send: (withField: boolean) => Promise<T>): Promise<T> {
  const cacheKey = `${key}\u0000${level}`;
  if (!sendsReasoningField(level) || rejected.has(cacheKey)) return send(false);
  try {
    return await send(true);
  } catch (err) {
    if (!isFieldRejection(err)) throw err;
    const result = await send(false);
    rejected.add(cacheKey);
    return result;
  }
}

/** Forgets every remembered rejection (tests). */
export function clearReasoningRejections(): void {
  rejected.clear();
}
