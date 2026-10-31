import {
  type ExportStyle,
  MAX_TEMPLATE_NAME_LENGTH,
  parseStyleTemplatesJson,
  randomId,
  type StyleTemplate,
  serializeStyleTemplates,
  validateExportStyle,
  validateStyleTemplate,
  validateTemplateName,
} from '@epubtrans/core';
import type { ProjectDatabase, StyleTemplateRow } from './project-database';

/** A saved template with its storage id. */
export interface SavedStyleTemplate extends StyleTemplate {
  id: string;
  updatedAt: string;
}

/** Saving or renaming to a name another template already has (names are unique, ignoring case). */
export class DuplicateTemplateNameError extends Error {
  override readonly name = 'DuplicateTemplateNameError';
  constructor(readonly templateName: string) {
    super(`A style template named "${templateName}" already exists`);
  }
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/** `name`, or `name (2)`, `name (3)`, … when taken; kept within the name length limit. */
function freeName(name: string, taken: readonly string[]): string {
  if (!taken.some((t) => sameName(t, name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, MAX_TEMPLATE_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.some((t) => sameName(t, candidate))) return candidate;
  }
}

export interface StyleTemplateStore {
  /** Every valid template, sorted by name. Rows that fail validation (edited storage) are skipped. */
  list(): Promise<SavedStyleTemplate[]>;
  findByName(name: string): Promise<SavedStyleTemplate | undefined>;
  /** Saves a new template; with `overwrite`, replaces the style of the template with that name instead of failing. */
  save(name: string, style: ExportStyle, options?: { overwrite?: boolean }): Promise<SavedStyleTemplate>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Adds the templates of a template file (validated); taken names get a " (2)" suffix. Returns what was added. */
  importJson(text: string): Promise<SavedStyleTemplate[]>;
  /** A template file with the given templates (all when `ids` is omitted). */
  exportJson(ids?: readonly string[]): Promise<string>;
}

/**
 * Named export styles in IndexedDB (`styleTemplates`), shared by every book. Everything read back or imported goes
 * through core's validation; template files are size-limited by core.
 */
export function createStyleTemplateStore(db: ProjectDatabase): StyleTemplateStore {
  const valid = (row: StyleTemplateRow): SavedStyleTemplate | undefined => {
    try {
      return { ...validateStyleTemplate({ name: row.name, style: row.style }), id: row.id, updatedAt: row.updatedAt };
    } catch {
      return undefined;
    }
  };
  const list = async () =>
    (await db.styleTemplates.toArray())
      .map(valid)
      .filter((t): t is SavedStyleTemplate => t !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    list,
    async findByName(name) {
      return (await list()).find((t) => sameName(t.name, name.trim()));
    },
    async save(rawName, rawStyle, options = {}) {
      const name = validateTemplateName(rawName);
      const style = validateExportStyle(rawStyle);
      return db.transaction('rw', db.styleTemplates, async () => {
        const existing = (await db.styleTemplates.toArray()).find((t) => sameName(t.name, name));
        if (existing && !options.overwrite) throw new DuplicateTemplateNameError(existing.name);
        const row: StyleTemplateRow = { id: existing?.id ?? randomId(), name, style, updatedAt: new Date().toISOString() };
        await db.styleTemplates.put(row);
        return { ...row };
      });
    },
    async rename(id, rawName) {
      const name = validateTemplateName(rawName);
      await db.transaction('rw', db.styleTemplates, async () => {
        const rows = await db.styleTemplates.toArray();
        const clash = rows.find((t) => t.id !== id && sameName(t.name, name));
        if (clash) throw new DuplicateTemplateNameError(clash.name);
        await db.styleTemplates.update(id, { name, updatedAt: new Date().toISOString() });
      });
    },
    async remove(id) {
      await db.styleTemplates.delete(id);
    },
    async importJson(text) {
      const templates = parseStyleTemplatesJson(text);
      return db.transaction('rw', db.styleTemplates, async () => {
        const taken = (await db.styleTemplates.toArray()).map((t) => t.name);
        const added: SavedStyleTemplate[] = [];
        for (const t of templates) {
          const row: StyleTemplateRow = { id: randomId(), name: freeName(t.name, taken), style: t.style, updatedAt: new Date().toISOString() };
          taken.push(row.name);
          await db.styleTemplates.put(row);
          added.push({ ...row });
        }
        return added;
      });
    },
    async exportJson(ids) {
      const all = await list();
      return serializeStyleTemplates((ids ? all.filter((t) => ids.includes(t.id)) : all).map(({ name, style }) => ({ name, style })));
    },
  };
}
