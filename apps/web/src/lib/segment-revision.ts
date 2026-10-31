import type { Segment, SegmentStatus } from '@epubtrans/core';
import type { SegmentStateRow } from './project-database';

/**
 * What a user edit, a retranslation or a translation job changes about a segment (the same fields core
 * compares to detect superseded segments). A missing overlay row means a pristine 'pending' segment.
 */
export interface SegmentRevision {
  status: SegmentStatus;
  translationHtml?: string;
}

type SegmentState = Pick<Segment, 'status' | 'translationHtml'>;

export function revisionOf(state: SegmentState | undefined): SegmentRevision {
  if (!state) return { status: 'pending' };
  return state.translationHtml === undefined ? { status: state.status } : { status: state.status, translationHtml: state.translationHtml };
}

export const sameRevision = (a: SegmentRevision, b: SegmentRevision): boolean => a.status === b.status && a.translationHtml === b.translationHtml;

/**
 * Compare-and-set decision: a writer that based its change on `expected` may only overwrite the stored
 * state when nobody else (another tab, a manual edit) changed it in the meantime.
 */
export const canOverwrite = (stored: SegmentStateRow | undefined, expected: SegmentRevision): boolean => sameRevision(revisionOf(stored), expected);

const STATUSES: ReadonlySet<string> = new Set<SegmentStatus>(['pending', 'translated', 'reviewed', 'error']);

/** Validates a segment overlay row read back from IndexedDB (written by this app, possibly by an older tab). */
export function isSegmentStateRow(value: unknown): value is SegmentStateRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.projectId === 'string' &&
    typeof row.id === 'string' &&
    typeof row.status === 'string' &&
    STATUSES.has(row.status) &&
    (row.translationHtml === undefined || typeof row.translationHtml === 'string') &&
    (row.error === undefined || typeof row.error === 'string')
  );
}

/**
 * Replaces the live segment's translation state with the stored one, but only when the live segment still
 * has the revision `since` (otherwise a newer local change owns it and its own pending write wins).
 * Returns whether the segment changed.
 */
export function applyStoredState(segment: Segment, since: SegmentRevision, stored: SegmentStateRow | undefined): boolean {
  if (!sameRevision(revisionOf(segment), since)) return false;
  const next = revisionOf(stored);
  if (sameRevision(next, since) && segment.error === stored?.error) return false;
  segment.status = next.status;
  if (next.translationHtml === undefined) delete segment.translationHtml;
  else segment.translationHtml = next.translationHtml;
  if (stored?.error === undefined) delete segment.error;
  else segment.error = stored.error;
  return true;
}
