import { saveProjectFile } from '@epubtrans/core';
import { useState } from 'react';
import { BookCard } from '../components/library/book-card';
import { BookImportZone } from '../components/library/book-import-zone';
import { Alert } from '../components/ui/layout-primitives';
import { useI18n } from '../i18n/i18n-context';
import { apiKeys } from '../lib/api-key-store';
import { repository } from '../lib/app-services';
import { isJobRunningElsewhere } from '../lib/cross-tab-job-lock';
import { downloadBytes, safeFileName } from '../lib/download-file';
import { useExternalStore } from '../lib/external-store';
import { BookImportError, isProjectFileName, readProjectFromFile } from '../lib/import-book-file';
import { errorText, pushNotice } from '../lib/notices';
import type { ProjectSummary } from '../lib/project-repository';
import { addProject, ensureProject, removeProject } from '../lib/project-store';
import { providerConfig } from '../lib/provider-config-store';
import { discardJob } from '../lib/translation-jobs';
import { useLibrary } from '../lib/use-library';

export function LibraryPage() {
  const { t } = useI18n();
  const { books, error } = useLibrary();
  const [busyName, setBusyName] = useState<string>();
  const [importError, setImportError] = useState<{ text: string; detail?: string }>();
  const config = useExternalStore(providerConfig.store);
  const keys = useExternalStore(apiKeys.store);
  const providerReady = Boolean(keys.keys[config.providerId] || config.providerId === 'custom');

  const importFiles = async (files: File[]) => {
    setImportError(undefined);
    for (const file of files) {
      setBusyName(file.name);
      try {
        const project = await readProjectFromFile(file);
        if (isProjectFileName(file.name) && (await repository.exists(project.id))) {
          if (await isJobRunningElsewhere(project.id)) {
            pushNotice('error', t('library.busyElsewhere'));
            continue;
          }
          if (!window.confirm(t('library.replaceConfirm', { title: project.title }))) continue;
          await discardJob(project.id);
        }
        await addProject(project);
        pushNotice('success', t('library.imported', { title: project.title }));
      } catch (err) {
        const kind = err instanceof BookImportError ? err.kind : 'generic';
        setImportError({ text: `${file.name}: ${t(`import.error.${kind}`)}`, detail: errorText(err) });
      } finally {
        setBusyName(undefined);
      }
    }
  };

  const exportProject = async (book: ProjectSummary) => {
    try {
      const bytes = await saveProjectFile(await ensureProject(book.id));
      downloadBytes(bytes, `${safeFileName(book.title)}.epubtrans`, 'application/zip');
    } catch (err) {
      pushNotice('error', errorText(err));
    }
  };

  const deleteBook = async (book: ProjectSummary) => {
    try {
      // The card disables Delete from a polled snapshot; re-check at click time.
      if (await isJobRunningElsewhere(book.id)) return pushNotice('error', t('library.busyElsewhere'));
      if (!window.confirm(t('library.deleteConfirm', { title: book.title }))) return;
      await discardJob(book.id);
      await removeProject(book.id);
      pushNotice('info', t('library.deleted', { title: book.title }));
    } catch (err) {
      pushNotice('error', errorText(err));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('library.title')}</h1>
      {!providerReady && (
        <Alert>
          <a href="#/settings" className="underline underline-offset-2">
            {t('library.noProvider')}
          </a>
        </Alert>
      )}
      <BookImportZone busy={busyName !== undefined} onFiles={(files) => void importFiles(files)} />
      {busyName && (
        <Alert>
          <span data-testid="import-busy">{t('library.importing', { name: busyName })}</span>
        </Alert>
      )}
      {importError && (
        <Alert kind="error">
          <p data-testid="import-error">{importError.text}</p>
          {importError.detail && <p className="mt-1 text-xs opacity-80">{t('import.error.detail', { message: importError.detail })}</p>}
        </Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {!books ? (
        <p className="text-sm text-stone-500">{t('common.loading')}</p>
      ) : books.length === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">{t('library.empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onExport={(b) => void exportProject(b)} onDelete={(b) => void deleteBook(b)} />
          ))}
        </ul>
      )}
    </div>
  );
}
