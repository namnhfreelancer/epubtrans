import { SEGMENT_ATTR } from '../dom/fragment-markup';
import type { Segment } from '../types';
import { addClass } from './segment-placement';

/** Attribute kept on segment blocks in preview builds, so a click in the preview can be mapped back to its segment. */
export const PREVIEW_SEGMENT_ATTR = SEGMENT_ATTR;
/** Class on blocks whose segment failed to translate (preview builds only). */
export const PREVIEW_ERROR_CLASS = 'et-error';
/** Class on blocks whose segment has no translation yet (preview builds only). */
export const PREVIEW_PENDING_CLASS = 'et-pending';

/**
 * Preview builds only: keeps the segment marker on block `el` and flags failed or untranslated segments.
 * Markers that name no known segment are dropped, as in a normal export.
 */
export function markPreviewSegment(el: Element, segment: Segment | undefined, done: boolean): void {
  if (!segment) {
    el.removeAttribute(SEGMENT_ATTR);
    return;
  }
  if (segment.status === 'error') addClass(el, PREVIEW_ERROR_CLASS);
  else if (!done) addClass(el, PREVIEW_PENDING_CLASS);
}
