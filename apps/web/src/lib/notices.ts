import { createExternalStore } from './external-store';

export interface Notice {
  id: number;
  kind: 'error' | 'success' | 'info';
  text: string;
}

/** Transient app-wide messages (toasts) for background operations that have no inline place to report. */
export const notices = createExternalStore<Notice[]>([]);
let nextId = 1;

export function pushNotice(kind: Notice['kind'], text: string, timeoutMs = kind === 'error' ? 10_000 : 4_000): void {
  const notice = { id: nextId++, kind, text };
  notices.set([...notices.get(), notice].slice(-4));
  setTimeout(() => dismissNotice(notice.id), timeoutMs);
}

export function dismissNotice(id: number): void {
  notices.set(notices.get().filter((n) => n.id !== id));
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
