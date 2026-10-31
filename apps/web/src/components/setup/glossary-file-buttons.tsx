import {
  applyGlossaryImport,
  formatGlossaryFile,
  type GlossaryEntry,
  type GlossaryFileFormat,
  type GlossaryImportMode,
  glossaryFileFormat,
  MAX_GLOSSARY_FILE_CHARS,
  type ParsedGlossaryFile,
  parseGlossaryFile,
} from '@epubtrans/core';
import { useId, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { downloadBytes, safeFileName } from '../../lib/download-file';
import { errorText, pushNotice } from '../../lib/notices';
import { Button } from '../ui/button';
import { ChoiceDialog } from '../ui/choice-dialog';

const MIME: Record<GlossaryFileFormat, string> = { csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json' };

/**
 * Glossary file import (CSV, TSV, JSON; validated, deduplicated) with a merge-or-replace choice when the book already
 * has entries, and export as CSV or JSON for reuse in another book or the CLI (`--glossary-file`). The import is
 * applied to the glossary as `readCurrent` finds it when the user decides (it may have changed while the choice was
 * open: a generated glossary, another tab), never to the list shown when the file was picked.
 */
export function GlossaryFileButtons({
  entries,
  bookTitle,
  onChange,
  locked,
  readCurrent,
}: {
  entries: GlossaryEntry[];
  bookTitle: string;
  onChange: (entries: GlossaryEntry[]) => void;
  locked: boolean;
  readCurrent: () => Promise<GlossaryEntry[]>;
}) {
  const { t } = useI18n();
  const inputId = useId();
  /** A parsed file waiting for the merge/replace decision. */
  const [pending, setPending] = useState<{ name: string; parsed: ParsedGlossaryFile }>();

  const apply = async (parsed: ParsedGlossaryFile, mode: GlossaryImportMode) => {
    try {
      const result = applyGlossaryImport(await readCurrent(), parsed.entries, mode);
      onChange(result.glossary);
      pushNotice('success', t('glossary.imported', { added: result.added, skipped: result.skipped + parsed.duplicates }));
    } catch (err) {
      pushNotice('error', t('glossary.importFailed', { message: errorText(err) }));
    }
  };

  const importFile = async (file: File) => {
    const format = glossaryFileFormat(file.name);
    if (!format) return pushNotice('error', t('glossary.importUnsupported'));
    try {
      if (file.size > MAX_GLOSSARY_FILE_CHARS * 4) throw new Error(t('glossary.importTooLarge'));
      const parsed = parseGlossaryFile(await file.text(), format);
      if (parsed.entries.length === 0) return pushNotice('error', t('glossary.importEmpty'));
      if (entries.length === 0) await apply(parsed, 'replace');
      else setPending({ name: file.name, parsed });
    } catch (err) {
      pushNotice('error', t('glossary.importFailed', { message: errorText(err) }));
    }
  };

  const exportAs = (format: GlossaryFileFormat) => {
    const name = `${safeFileName(bookTitle)}.glossary.${format}`;
    downloadBytes(new TextEncoder().encode(formatGlossaryFile(entries, format)), name, MIME[format]);
  };

  return (
    <>
      <label
        htmlFor={inputId}
        className={`inline-flex cursor-pointer items-center rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100 focus-within:outline-2 focus-within:outline-teal-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${locked ? 'pointer-events-none opacity-50' : ''}`}
      >
        {t('glossary.import')}
        <input
          id={inputId}
          data-testid="glossary-file-input"
          type="file"
          accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
          className="sr-only"
          disabled={locked}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </label>
      <Button size="sm" data-testid="glossary-export-csv" disabled={entries.length === 0} onClick={() => exportAs('csv')}>
        {t('glossary.exportCsv')}
      </Button>
      <Button size="sm" data-testid="glossary-export-json" disabled={entries.length === 0} onClick={() => exportAs('json')}>
        {t('glossary.exportJson')}
      </Button>
      {pending && (
        <ChoiceDialog<GlossaryImportMode>
          testId="glossary-import-dialog"
          title={t('glossary.importTitle', { name: pending.name })}
          cancelLabel={t('common.cancel')}
          choices={[
            { id: 'merge', label: t('glossary.importMerge'), variant: 'primary' },
            { id: 'replace', label: t('glossary.importReplace'), variant: 'danger' },
          ]}
          onClose={(mode) => {
            const { parsed } = pending;
            setPending(undefined);
            // Generation rewrites the glossary when it finishes, which would drop an import applied meanwhile.
            if (mode && locked) pushNotice('error', t('glossary.importLocked'));
            else if (mode) void apply(parsed, mode);
          }}
        >
          <p>{t('glossary.importBody', { n: pending.parsed.entries.length, existing: entries.length })}</p>
        </ChoiceDialog>
      )}
    </>
  );
}
