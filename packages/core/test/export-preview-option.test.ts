import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_MODES, exportEpub, importBook, PREVIEW_ERROR_CLASS, PREVIEW_PENDING_CLASS, PREVIEW_SEGMENT_ATTR, type Project, type Segment } from '../src';
import { readZip } from '../src/util/zip-archive';
import { env, fakeTranslate, readFixture } from './test-helpers';

/** Every 5th segment failed, every 7th is untranslated, the rest are translated. */
async function mixedProject(): Promise<{ project: Project; failed: Segment; pending: Segment }> {
  const project = await importBook(readFixture('a-modest-proposal.epub'), 'a-modest-proposal.epub', env);
  const body = project.chapters[2]?.segments ?? [];
  project.chapters
    .flatMap((c) => c.segments)
    .forEach((s, i) => {
      if (i % 5 === 4) s.status = 'error';
      else if (i % 7 === 6) s.status = 'pending';
      else {
        s.translationHtml = fakeTranslate(s.sourceHtml);
        s.status = 'translated';
      }
    });
  const failed = body.find((s) => s.status === 'error');
  const pending = body.find((s) => s.status === 'pending');
  if (!failed || !pending) throw new Error('fixture changed');
  return { project, failed, pending };
}

const decode = (data: Uint8Array) => new TextDecoder().decode(data);
/** Removes what a preview build adds: segment markers and the two status classes. */
const unmark = (text: string) =>
  text
    .replace(new RegExp(` ${PREVIEW_SEGMENT_ATTR}="[^"]*"`, 'g'), '')
    .replace(new RegExp(` class="(${PREVIEW_ERROR_CLASS}|${PREVIEW_PENDING_CLASS})"`, 'g'), '')
    .replace(new RegExp(` (${PREVIEW_ERROR_CLASS}|${PREVIEW_PENDING_CLASS})(?=")`, 'g'), '');

describe('exportEpub preview option', () => {
  beforeEach(() => {
    // dcterms:modified is the only time-dependent byte; pin it so whole archives compare byte for byte.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T06:40:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  for (const mode of EXPORT_MODES) {
    it(`keeps segment ids and marks failed/untranslated segments in ${mode}`, async () => {
      const { project, failed, pending } = await mixedProject();
      const chapter = project.chapters[2];
      if (!chapter) throw new Error('fixture changed');
      const out = await exportEpub(project, mode, env, { preview: true });
      const html = decode(readZip(out).get(chapter.href) ?? new Uint8Array());
      expect(html).toMatch(new RegExp(`<p[^>]*class="${PREVIEW_ERROR_CLASS}"[^>]*${PREVIEW_SEGMENT_ATTR}="${failed.id}"`));
      expect(html).toMatch(new RegExp(`<p[^>]*class="${PREVIEW_PENDING_CLASS}"[^>]*${PREVIEW_SEGMENT_ATTR}="${pending.id}"`));
      const done = chapter.segments.find((s) => s.status === 'translated');
      expect(html).toContain(`${PREVIEW_SEGMENT_ATTR}="${done?.id}"`);
      // A translated block is never flagged.
      expect(html).not.toMatch(new RegExp(`class="[^"]*et-(error|pending)[^"]*"[^>]*${PREVIEW_SEGMENT_ATTR}="${done?.id}"`));
    });

    it(`leaves the default ${mode} export byte-identical and free of preview markers`, async () => {
      const { project } = await mixedProject();
      const plain = await exportEpub(project, mode, env);
      expect(await exportEpub(project, mode, env, {})).toEqual(plain);
      expect(await exportEpub(project, mode, env, { preview: false })).toEqual(plain);

      const preview = readZip(await exportEpub(project, mode, env, { preview: true }));
      const files = readZip(plain);
      expect([...preview.keys()].sort()).toEqual([...files.keys()].sort());
      for (const [name, data] of files) {
        const text = decode(data);
        expect(text, name).not.toContain(PREVIEW_SEGMENT_ATTR);
        expect(text, name).not.toMatch(/et-(error|pending)/);
        // The preview differs from the download only by the markers it adds.
        expect(unmark(decode(preview.get(name) ?? new Uint8Array())), name).toBe(text);
      }
    });
  }
});
