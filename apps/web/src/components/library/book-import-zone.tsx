import { useId, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { ACCEPTED_EXTENSIONS } from '../../lib/import-book-file';

/**
 * Drop area for books and `.epubtrans` project files. The whole area is the label of the file input,
 * so clicking anywhere (or pressing Enter/Space on the focused input) opens the picker.
 */
export function BookImportZone({ busy, onFiles }: { busy: boolean; onFiles: (files: File[]) => void }) {
  const { t } = useI18n();
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy && e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition focus-within:border-teal-600 ${
        dragging ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40' : 'border-stone-300 bg-white hover:border-teal-500 dark:border-stone-700 dark:bg-stone-900'
      } ${busy ? 'pointer-events-none opacity-60' : ''}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-10 w-10 text-teal-700 dark:text-teal-400" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>
        <span className="block font-medium">{t('library.dropTitle')}</span>
        <span className="mt-1 block text-sm text-stone-500 dark:text-stone-400">{t('library.dropHint')}</span>
      </span>
      <span className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">{t('library.choose')}</span>
      <input
        id={inputId}
        data-testid="book-file-input"
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}
