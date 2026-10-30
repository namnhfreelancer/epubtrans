import { rename, rm } from 'node:fs/promises';
import { type Project, saveProjectFile } from '@epubtrans/core';

/** Writes via a temp file and rename so a crash or Ctrl-C never leaves a half-written file behind. */
export async function writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await Bun.write(tmp, bytes);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function writeProjectFile(project: Project, path: string): Promise<void> {
  await writeFileAtomic(path, await saveProjectFile(project));
}

export interface ProjectSaver {
  /** Schedules a save; calls within `intervalMs` collapse into one write. */
  markDirty(): void;
  /** Writes pending changes now and waits for every write to finish; rejects if any save failed. */
  flush(): Promise<void>;
}

/**
 * Throttled, serialized project saver. A failed save is reported through `onError` right away
 * (the run must stop: progress is no longer being persisted) and again by `flush`.
 */
export function createProjectSaver(project: Project, path: string, onError: (err: Error) => void, intervalMs = 2000): ProjectSaver {
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let failure: Error | undefined;

  const write = (): Promise<void> => {
    dirty = false;
    chain = chain.then(async () => {
      try {
        await writeProjectFile(project, path);
      } catch (err) {
        failure ??= new Error(`Cannot save project file ${path}: ${err instanceof Error ? err.message : String(err)}`);
        onError(failure);
      }
    });
    return chain;
  };

  return {
    markDirty() {
      dirty = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (dirty) void write();
      }, intervalMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await (dirty ? write() : chain);
      if (failure) throw failure;
    },
  };
}
