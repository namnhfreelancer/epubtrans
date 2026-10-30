/**
 * Minimal Storage surface used by the app. localStorage can be missing or throw
 * (private mode, disabled storage, quota), so every access goes through these guards.
 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readString(storage: KeyValueStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the value could not be stored. */
export function writeString(storage: KeyValueStorage | undefined, key: string, value: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(storage: KeyValueStorage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/** Reads JSON and passes it through `validate`; corrupt or invalid data yields `fallback`. */
export function readJson<T>(storage: KeyValueStorage | undefined, key: string, validate: (value: unknown) => T | undefined, fallback: T): T {
  const raw = readString(storage, key);
  if (raw === null) return fallback;
  try {
    return validate(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
