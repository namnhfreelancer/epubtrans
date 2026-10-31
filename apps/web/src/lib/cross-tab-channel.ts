/**
 * Same-origin tabs share IndexedDB but each holds its own in-memory projects. A BroadcastChannel per
 * project (`epubtrans:<projectId>`) tells the other tabs what changed so they can re-read it from storage:
 * - `segment`: a segment's stored translation state changed (job result, edit, retranslation),
 * - `job`: a translation job for the project started or ended somewhere,
 * - `settings`: the project's settings changed; with `reset`, every segment's translation state was dropped too,
 * - `hints`: Word Wise hints of the project were added or replaced.
 * Messages carry ids only; receivers always read the data itself from IndexedDB, the source of truth.
 * Without BroadcastChannel support every function here is a no-op.
 */
export type CrossTabMessage = { type: 'segment'; segmentId: string } | { type: 'job' } | { type: 'settings'; reset: boolean } | { type: 'hints' };
type Handler = (projectId: string, message: CrossTabMessage) => void;

const channels = new Map<string, BroadcastChannel>();
const handlers = new Set<Handler>();

function parseMessage(data: unknown): CrossTabMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const msg = data as Record<string, unknown>;
  if (msg.type === 'job') return { type: 'job' };
  if (msg.type === 'settings') return { type: 'settings', reset: msg.reset === true };
  if (msg.type === 'hints') return { type: 'hints' };
  if (msg.type === 'segment' && typeof msg.segmentId === 'string' && msg.segmentId) return { type: 'segment', segmentId: msg.segmentId };
  return undefined;
}

function channelFor(projectId: string): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  let channel = channels.get(projectId);
  if (!channel) {
    channel = new BroadcastChannel(`epubtrans:${projectId}`);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseMessage(event.data);
      if (message) for (const h of [...handlers]) h(projectId, message);
    };
    channels.set(projectId, channel);
  }
  return channel;
}

/** Starts receiving messages about a project in this tab (idempotent). */
export function watchProjectChannel(projectId: string): void {
  channelFor(projectId);
}

export function closeProjectChannel(projectId: string): void {
  channels.get(projectId)?.close();
  channels.delete(projectId);
}

/** Tells the other tabs about a change; never throws (cross-tab sync is best effort on top of storage). */
export function broadcast(projectId: string, message: CrossTabMessage): void {
  try {
    channelFor(projectId)?.postMessage(message);
  } catch (err) {
    console.warn('epubtrans: cross-tab broadcast failed', err);
  }
}

export function onCrossTabMessage(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
