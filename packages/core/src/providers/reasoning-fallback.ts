import type { ReasoningLevel } from '../types';
import { ProviderError } from './provider-http';

/**
 * For each endpoint, model and level: the index of the first reasoning field variant to send, learned during this
 * session (page or process lifetime). An index past the last variant means "send no field". Later requests start
 * there, so a rejection costs extra requests once per session, not once per batch.
 */
const firstVariant = new Map<string, number>();

/** Statuses an endpoint answers when it does not know a request field or value. */
const isFieldRejection = (err: unknown) => err instanceof ProviderError && (err.status === 400 || err.status === 422);

/** Whether `level` asks for a request field at all (`default` leaves the provider's behaviour alone). */
export const sendsReasoningField = (level: ReasoningLevel | undefined): level is 'low' | 'off' => level === 'low' || level === 'off';

/**
 * Sends a request with the first reasoning field variant (most faithful first: `none`, then `minimal` for "off"); when
 * the endpoint answers 400/422 it tries the next variant, and after the last one the request without the field. The
 * variant that succeeds is remembered for later requests. Rejected attempts never reach the caller, so they do not
 * count toward the run's consecutive client-error stop. When the request fails without the field too, the field was
 * not the problem: that error propagates and nothing is remembered.
 */
export async function withReasoningFallback<V, T>(key: string, variants: readonly V[], send: (variant: V | undefined) => Promise<T>): Promise<T> {
  if (variants.length === 0) return send(undefined);
  let index = firstVariant.get(key) ?? 0;
  const start = index;
  for (;;) {
    try {
      const result = await send(variants[index]);
      if (index !== start) firstVariant.set(key, index);
      return result;
    } catch (err) {
      if (index >= variants.length || !isFieldRejection(err)) throw err;
      index++;
    }
  }
}

/** Forgets every remembered rejection (tests). */
export function clearReasoningRejections(): void {
  firstVariant.clear();
}
