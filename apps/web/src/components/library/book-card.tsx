import { useI18n } from '../../i18n/i18n-context';
import { formatNumber } from '../../lib/format';
import { routeHref } from '../../lib/hash-route';
import { languageLabel } from '../../lib/languages';
import type { ProjectSummary } from '../../lib/project-repository';
import { Button } from '../ui/button';
import { ProgressBar } from '../ui/layout-primitives';

interface BookCardProps {
  book: ProjectSummary;
  onExport: (book: ProjectSummary) => void;
  onDelete: (book: ProjectSummary) => void;
}

export function BookCard({ book, onExport, onDelete }: BookCardProps) {
  const { t, locale } = useI18n();
  return (
    <li
      data-testid="book-card"
      className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="min-w-0">
        <a href={routeHref({ name: 'book', id: book.id, tab: 'setup' })} className="line-clamp-2 font-semibold hover:text-teal-700 dark:hover:text-teal-400">
          {book.title}
        </a>
        {book.author && <p className="truncate text-sm text-stone-500 dark:text-stone-400">{t('library.byAuthor', { author: book.author })}</p>}
      </div>
      <div className="space-y-1.5">
        <ProgressBar value={book.done} max={book.total} label={book.title} />
        <p className="flex flex-wrap gap-x-3 text-xs text-stone-500 dark:text-stone-400">
          <span data-testid="book-progress">{t('library.progress', { done: formatNumber(book.done, locale), total: formatNumber(book.total, locale) })}</span>
          <span>→ {languageLabel(book.targetLang, locale)}</span>
          {book.errors > 0 && <span className="text-red-700 dark:text-red-400">{t('library.errors', { n: book.errors })}</span>}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <a
          href={routeHref({ name: 'book', id: book.id, tab: 'setup' })}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 dark:hover:bg-teal-600"
        >
          {t('library.open')}
        </a>
        <Button size="sm" onClick={() => onExport(book)}>
          {t('library.exportProject')}
        </Button>
        <Button size="sm" variant="danger" className="ml-auto" onClick={() => onDelete(book)}>
          {t('library.delete')}
        </Button>
      </div>
    </li>
  );
}
