import { MAX_STYLE_FILE_BYTES, MAX_TEMPLATE_NAME_LENGTH, type Project } from '@epubtrans/core';
import { useRef, useState } from 'react';
import { styleTemplates } from '../../lib/app-services';
import { downloadBytes } from '../../lib/download-file';
import { ignoredKeysText } from '../../lib/export-style-edit';
import { dialogText } from '../../lib/format';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-settings-store';
import { DuplicateTemplateNameError, type SavedStyleTemplate } from '../../lib/style-template-store';
import { touchStyleTemplates, useStyleTemplates } from '../../lib/use-style-templates';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { useStyleText } from './export-style-messages';

const TEMPLATE_FILE = 'epubtrans-style-templates.json';

/**
 * Named export styles shared by every book: save the book's style, apply a template to the book, rename, delete, and
 * export/import template files (validated and size-limited by core; also readable by the CLI's `--style-file`).
 */
export function StyleTemplateManager({ project }: { project: Project }) {
  const s = useStyleText();
  const { templates, error } = useStyleTemplates();
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      pushNotice(
        'error',
        err instanceof DuplicateTemplateNameError ? s('templates.duplicate', { name: err.templateName }) : s('templates.failed', { message: errorText(err) }),
      );
    } finally {
      touchStyleTemplates();
    }
  };

  const save = () =>
    act(async () => {
      const style = project.settings.exportStyle ?? {};
      try {
        await styleTemplates.save(name, style);
      } catch (err) {
        if (!(err instanceof DuplicateTemplateNameError) || !window.confirm(s('templates.overwriteConfirm', { name: dialogText(err.templateName, 80) })))
          throw err;
        await styleTemplates.save(name, style, { overwrite: true });
      }
      pushNotice('success', s('templates.saved', { name: name.trim() }));
      setName('');
    });

  const apply = (t: SavedStyleTemplate) =>
    act(async () => {
      await updateSettings(project, { exportStyle: t.style });
      pushNotice('success', s('templates.applied', { name: t.name }));
    });

  const rename = (t: SavedStyleTemplate) =>
    act(async () => {
      const next = window.prompt(s('templates.renamePrompt', { name: dialogText(t.name, 80) }), t.name);
      if (next !== null && next.trim() !== t.name) await styleTemplates.rename(t.id, next);
    });

  const remove = (t: SavedStyleTemplate) =>
    act(async () => {
      if (window.confirm(s('templates.deleteConfirm', { name: dialogText(t.name, 80) }))) await styleTemplates.remove(t.id);
    });

  const exportFile = (ids?: string[]) =>
    act(async () => downloadBytes(new TextEncoder().encode(await styleTemplates.exportJson(ids)), TEMPLATE_FILE, 'application/json'));

  const importFile = (file: File | undefined) =>
    act(async () => {
      if (!file) return;
      if (file.size > MAX_STYLE_FILE_BYTES) throw new Error(`larger than ${MAX_STYLE_FILE_BYTES / 1024} KB`);
      const { added, ignoredKeys } = await styleTemplates.importJson(await file.text());
      pushNotice('success', s('templates.imported', { n: added.length }));
      if (ignoredKeys.length > 0) pushNotice('info', s('templates.ignoredKeys', { keys: ignoredKeysText(ignoredKeys) }), 10_000);
    });

  return (
    <div data-testid="style-templates" className="space-y-3">
      <p className="text-sm text-stone-600 dark:text-stone-400">{s('templates.intro')}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          data-testid="template-name"
          aria-label={s('templates.name')}
          placeholder={s('templates.name')}
          maxLength={MAX_TEMPLATE_NAME_LENGTH}
          className={INPUT_CLASS}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" data-testid="template-save" disabled={name.trim() === ''}>
          {s('templates.save')}
        </Button>
      </form>
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      {templates.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">{s('templates.empty')}</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {templates.map((t) => (
            <li key={t.id} data-testid="template-item" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate text-sm font-medium" title={t.name}>
                {t.name}
              </span>
              <span className="flex flex-wrap gap-1">
                <Button size="sm" variant="primary" data-testid="template-apply" onClick={() => void apply(t)}>
                  {s('templates.apply')}
                </Button>
                <Button size="sm" data-testid="template-rename" onClick={() => void rename(t)}>
                  {s('templates.rename')}
                </Button>
                <Button size="sm" data-testid="template-export" onClick={() => void exportFile([t.id])}>
                  {s('templates.export')}
                </Button>
                <Button size="sm" variant="danger" data-testid="template-delete" onClick={() => void remove(t)}>
                  {s('templates.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="template-export-all" disabled={templates.length === 0} onClick={() => void exportFile()}>
          {s('templates.exportAll')}
        </Button>
        <Button size="sm" data-testid="template-import" onClick={() => fileInput.current?.click()}>
          {s('templates.import')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="template-import-file"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
