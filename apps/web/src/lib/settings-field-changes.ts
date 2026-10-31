import type { ProjectSettings } from '@epubtrans/core';

/**
 * Settings changes saved field by field. The nested settings (Word Wise options, export style, glossary) are edited
 * one field at a time, possibly in two tabs at once; saving the whole object a tab holds would write back its stale
 * copy of the fields the other tab changed. So a change of a nested setting is turned into the fields that differ from
 * what the tab had, and only those are merged into the stored settings.
 */

/** Settings holding objects (or a list edited by position) whose fields are saved one by one. */
const NESTED_KEYS = new Set<keyof ProjectSettings>(['wordHints', 'exportStyle', 'glossary']);

/** One changed field, addressed from the settings root: a nested key, then object keys or list positions. */
export interface FieldChange {
  path: (string | number)[];
  /** The new value; with `remove`, the field is deleted instead. */
  value?: unknown;
  remove?: true;
  /**
   * Set on a whole list saved before position-wise changes of its entries: it is written only when the stored list does
   * not have this length (entries were added or removed elsewhere, so positions no longer match and the tab's list wins).
   */
  unlessLength?: number;
}

/** A settings change: top-level values replaced as a whole, plus field-wise changes of the nested settings. */
export interface SettingsUpdate {
  patch: Partial<ProjectSettings>;
  changes: FieldChange[];
}

type Container = Record<string | number, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Appends the changes that turn `before` into `after` at `path`. */
function diff(before: unknown, after: unknown, path: (string | number)[], out: FieldChange[]): void {
  if (sameValue(before, after)) return;
  if (after === undefined) {
    out.push({ path, remove: true });
    return;
  }
  if (isPlainObject(after) && (before === undefined || isPlainObject(before))) {
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
    for (const key of keys) diff(before?.[key], after[key], [...path, key], out);
    return;
  }
  // A list edited in place (same length) is saved entry by entry, guarded by its length; any other list as a whole.
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length && path.length === 1) {
    out.push({ path, value: after, unlessLength: before.length });
    for (let i = 0; i < after.length; i++) diff(before[i], after[i], [...path, i], out);
    return;
  }
  out.push({ path, value: after });
}

/** Splits a patch the tab applies to `base` (its current settings) into top-level values and nested field changes. */
export function toSettingsUpdate(base: ProjectSettings, patch: Partial<ProjectSettings>): SettingsUpdate {
  const top: Partial<ProjectSettings> = {};
  const changes: FieldChange[] = [];
  for (const key of Object.keys(patch) as (keyof ProjectSettings)[]) {
    if (NESTED_KEYS.has(key)) diff(base[key], patch[key], [key], changes);
    else Object.assign(top, { [key]: patch[key] });
  }
  return { patch: top, changes };
}

/** Applies one change to `root` in place, copying every object or list on its path first (the input stays untouched). */
function applyChange(root: Container, change: FieldChange): void {
  let node: Container = root;
  for (let i = 0; i < change.path.length - 1; i++) {
    const key = change.path[i] as string | number;
    const child = node[key];
    const copy: Container = Array.isArray(child) ? ([...child] as unknown as Container) : isPlainObject(child) ? { ...child } : {};
    node[key] = copy;
    node = copy;
  }
  const last = change.path.at(-1) as string | number;
  const current = node[last];
  if (change.unlessLength !== undefined && Array.isArray(current) && current.length === change.unlessLength) return;
  if (change.remove) delete node[last];
  else node[last] = structuredClone(change.value);
}

/** The settings with an update applied: top-level values replaced, then each field change merged in order. */
export function applySettingsUpdate(settings: ProjectSettings, update: SettingsUpdate): ProjectSettings {
  const next = { ...settings, ...update.patch } as unknown as Container;
  for (const change of update.changes) applyChange(next, change);
  return next as unknown as ProjectSettings;
}
