import { GLOSSARY_TERM_TYPES, type GlossaryEntry, type GlossaryTermType } from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { GLOSSARY_PAGE_SIZE, GLOSSARY_TYPE_FILTERS, type GlossaryTypeFilter, glossaryPage, patchGlossaryEntry } from '../../lib/glossary-view';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { GlossaryFileButtons } from './glossary-file-buttons';

/**
 * Editable glossary for hundreds of entries: search over term/translation/note, type filter, entry counts and
 * paging (50 rows per page). Edits go to the entry's position in the full list, whatever the filter.
 * `locked` disables every edit (search, filter and paging keep working), e.g. while generation rewrites the glossary.
 */
export function GlossaryTable({
  entries,
  onChange,
  locked = false,
  bookTitle,
}: {
  entries: GlossaryEntry[];
  onChange: (entries: GlossaryEntry[]) => void;
  locked?: boolean;
  /** Names exported glossary files. */
  bookTitle: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<GlossaryTypeFilter>('all');
  const [page, setPage] = useState(0);
  const view = glossaryPage(entries, query, type, page);
  const filtered = query.trim() !== '' || type !== 'all';

  const update = (index: number, patch: Partial<GlossaryEntry>) => onChange(patchGlossaryEntry(entries, index, patch));
  const add = () => {
    // Show the new (empty) row: clear the filters and jump to the last page.
    setQuery('');
    setType('all');
    setPage(Math.floor(entries.length / GLOSSARY_PAGE_SIZE));
    onChange([...entries, { term: '', translation: '' }]);
  };
  const typeLabel = (value: GlossaryTypeFilter) =>
    value === 'all' ? t('glossary.typeAll') : value === 'none' ? t('glossary.typeNone') : t(`glossary.type.${value}`);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t('setup.glossary')}{' '}
          <span data-testid="glossary-count" className="font-normal text-stone-500 dark:text-stone-400">
            {filtered ? t('glossary.count', { visible: view.matches, total: entries.length }) : t('glossary.countAll', { total: entries.length })}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <GlossaryFileButtons entries={entries} bookTitle={bookTitle} onChange={onChange} locked={locked} />
          <Button size="sm" onClick={add} disabled={locked}>
            {t('setup.addTerm')}
          </Button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">{t('setup.glossaryEmpty')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              aria-label={t('glossary.search')}
              placeholder={t('glossary.search')}
              className={`${INPUT_CLASS} min-w-48 flex-1`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label={t('glossary.typeFilter')}
              className={`${INPUT_CLASS} w-44`}
              value={type}
              onChange={(e) => {
                setType(e.target.value as GlossaryTypeFilter);
                setPage(0);
              }}
            >
              {GLOSSARY_TYPE_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {typeLabel(value)}
                </option>
              ))}
            </select>
          </div>
          {view.matches === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">{t('glossary.noMatch')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table data-testid="glossary-table" className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-500 dark:text-stone-400">
                    <th className="pb-1 pr-2 font-medium">{t('setup.term')}</th>
                    <th className="pb-1 pr-2 font-medium">{t('setup.translation')}</th>
                    <th className="w-36 pb-1 pr-2 font-medium">{t('glossary.type')}</th>
                    <th className="pb-1 pr-2 font-medium">{t('setup.note')}</th>
                    <th className="w-14 pb-1 pr-2 text-right font-medium">{t('glossary.occurrences')}</th>
                    <th className="pb-1">
                      <span className="sr-only">{t('setup.removeTerm')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map(({ entry, index }) => (
                    // Keyed by position in the full glossary: terms may be empty or duplicated while editing.
                    <tr key={index} data-testid="glossary-row">
                      <td className="py-1 pr-2">
                        <input
                          aria-label={t('setup.term')}
                          className={INPUT_CLASS}
                          disabled={locked}
                          value={entry.term}
                          onChange={(e) => update(index, { term: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          aria-label={t('setup.translation')}
                          className={INPUT_CLASS}
                          disabled={locked}
                          value={entry.translation}
                          onChange={(e) => update(index, { translation: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          aria-label={t('glossary.type')}
                          className={INPUT_CLASS}
                          disabled={locked}
                          value={entry.type ?? ''}
                          onChange={(e) => update(index, e.target.value ? { type: e.target.value as GlossaryTermType } : { type: undefined })}
                        >
                          <option value="">{t('glossary.typeNone')}</option>
                          {GLOSSARY_TERM_TYPES.map((value) => (
                            <option key={value} value={value}>
                              {t(`glossary.type.${value}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          aria-label={t('setup.note')}
                          className={INPUT_CLASS}
                          disabled={locked}
                          value={entry.note ?? ''}
                          onChange={(e) => update(index, { note: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-stone-500 dark:text-stone-400">{entry.count ?? ''}</td>
                      <td className="py-1">
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={t('setup.removeTerm')}
                          disabled={locked}
                          onClick={() => onChange(entries.filter((_, j) => j !== index))}
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view.pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-xs text-stone-600 dark:text-stone-400">
              <Button size="sm" variant="ghost" disabled={view.page === 0} onClick={() => setPage(view.page - 1)}>
                {t('glossary.prevPage')}
              </Button>
              <span data-testid="glossary-page">{t('glossary.page', { page: view.page + 1, pages: view.pages })}</span>
              <Button size="sm" variant="ghost" disabled={view.page >= view.pages - 1} onClick={() => setPage(view.page + 1)}>
                {t('glossary.nextPage')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
