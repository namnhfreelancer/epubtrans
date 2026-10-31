import { expect, type Frame, type Page } from '@playwright/test';

/**
 * The rendered section document: foliate draws each section into a blob: iframe inside closed shadow roots, and
 * replaces the iframe when the section changes, so it is looked up afresh by its content.
 */
export async function sectionFrame(page: Page, selector: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (frame.isDetached() || !frame.url().startsWith('blob:')) continue;
        try {
          if ((await frame.locator(selector).count()) > 0) {
            found = frame;
            return true;
          }
        } catch {
          // Detached while being queried (a rebuild replaced it): keep polling.
        }
      }
      return false;
    })
    .toBe(true);
  return found as Frame;
}

/**
 * Evaluates `fn` on the first element matching `selector` in the current section document, or returns undefined
 * (none yet, or a rebuild replaced the frame meanwhile); meant for `expect.poll`.
 */
export async function evalInSection<T>(page: Page, selector: string, fn: (el: Element) => T): Promise<T | undefined> {
  for (const frame of page.frames()) {
    if (frame.isDetached() || !frame.url().startsWith('blob:')) continue;
    try {
      const target = frame.locator(selector).first();
      if ((await target.count()) > 0) return await target.evaluate(fn);
    } catch {
      // Replaced by a rebuild while being queried.
    }
  }
  return undefined;
}
