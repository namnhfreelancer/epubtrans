import type { ChatProvider, Project, ProjectSettings, Segment } from '../types';
import { runBatch } from './batch-runner';
import { validateSettings } from './translate-project';

/**
 * Translates one segment again regardless of its status (and reviews it when `twoPass`).
 * The project segment is only replaced on success, so a failed attempt keeps the old translation; a successful one
 * clears `userEdited` (this is an explicit user request, unlike the automatic runs that skip edited segments).
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
  // The reason alone: callers add their own "Retranslation failed" context.
  if (draft.status === 'error') throw new Error(draft.error ?? 'unknown error');
  if (settings.twoPass) await runBatch([draft], 'review', ctx);
  segment.translationHtml = draft.translationHtml;
  segment.status = draft.status;
  // The user asked for a fresh machine translation, which replaces any hand edit.
  delete segment.userEdited;
  if (draft.error) segment.error = draft.error;
  else delete segment.error;
  if (draft.warning) segment.warning = draft.warning;
  else delete segment.warning;
  project.updatedAt = new Date().toISOString();
  return segment;
}
