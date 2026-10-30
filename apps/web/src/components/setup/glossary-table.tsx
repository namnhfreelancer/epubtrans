import type { GlossaryEntry } from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';

/** Editable glossary: term → translation (+ optional note). */
export function GlossaryTable({ entries, onChange }: { entries: GlossaryEntry[]; onChange: (entries: GlossaryEntry[]) => void }) {
  const { t } = useI18n();

  const update = (index: number, patch: Partial<GlossaryEntry>) =>
    onChange(
      entries.map((e, i) => {
        if (i !== index) return e;
        const next = { ...e, ...patch };
        if (!next.note) delete next.note;
        return next;
      }),
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('setup.glossary')}</h3>
        <Button size="sm" onClick={() => onChange([...entries, { term: '', translation: '' }])}>
          {t('setup.addTerm')}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">{t('setup.glossaryEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="glossary-table" className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500 dark:text-stone-400">
                <th className="pb-1 pr-2 font-medium">{t('setup.term')}</th>
                <th className="pb-1 pr-2 font-medium">{t('setup.translation')}</th>
                <th className="pb-1 pr-2 font-medium">{t('setup.note')}</th>
                <th className="pb-1">
                  <span className="sr-only">{t('setup.removeTerm')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; terms may be empty or duplicated while editing.
                <tr key={i} data-testid="glossary-row">
                  <td className="py-1 pr-2">
                    <input aria-label={t('setup.term')} className={INPUT_CLASS} value={entry.term} onChange={(e) => update(i, { term: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={t('setup.translation')}
                      className={INPUT_CLASS}
                      value={entry.translation}
                      onChange={(e) => update(i, { translation: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={t('setup.note')}
                      className={INPUT_CLASS}
                      value={entry.note ?? ''}
                      onChange={(e) => update(i, { note: e.target.value })}
                    />
                  </td>
                  <td className="py-1">
                    <Button size="sm" variant="danger" aria-label={t('setup.removeTerm')} onClick={() => onChange(entries.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
