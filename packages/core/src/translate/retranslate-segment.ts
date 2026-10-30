import type { ChatProvider, Project, ProjectSettings, Segment } from '../types';
import { runBatch } from './batch-runner';
import { validateSettings } from './translate-project';

/**
 * Translates one segment again regardless of its status (and reviews it when `twoPass`).
 * The project segment is only replaced on success, so a failed attempt keeps the old translation.
 */
export async function retranslateSegment(
  project: Project,
  segmentId: string,
  provider: ChatProvider,
  settings: ProjectSettings,
  signal?: AbortSignal,
): Promise<Segment> {
  validateSettings(settings);
  const segment = project.chapters.flatMap((c) => c.segments).find((s) => s.id === segmentId);
  if (!segment) throw new Error(`Unknown segment: ${segmentId}`);
  const draft: Segment = { id: segment.id, sourceHtml: segment.sourceHtml, sourceText: segment.sourceText, status: 'pending' };
  const ctx = { provider, settings, signal: signal ?? new AbortController().signal, usage: { input: 0, output: 0 }, commit: () => {}, clientErrors: 0 };
  await runBatch([draft], 'translate', ctx);
  if (draft.status === 'error') throw new Error(`Retranslation failed: ${draft.error ?? 'unknown error'}`);
  if (settings.twoPass) await runBatch([draft], 'review', ctx);
  segment.translationHtml = draft.translationHtml;
  segment.status = draft.status;
  if (draft.error) segment.error = draft.error;
  else delete segment.error;
  project.updatedAt = new Date().toISOString();
  return segment;
}
