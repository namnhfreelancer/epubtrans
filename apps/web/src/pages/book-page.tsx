import { ExportPanel } from '../components/export/export-panel';
import { ReaderPanel } from '../components/reader/reader-panel';
import { TranslationSetupPanel } from '../components/setup/translation-setup-panel';
import { Alert } from '../components/ui/layout-primitives';
import { useI18n } from '../i18n/i18n-context';
import { type BookTab, routeHref } from '../lib/hash-route';
import { useProject } from '../lib/project-store';

const TABS: BookTab[] = ['setup', 'read', 'export'];

export function BookPage({ id, tab, segment }: { id: string; tab: BookTab; segment?: string }) {
  const { t } = useI18n();
  const { project, error, loading, version } = useProject(id);

  if (loading) return <p className="text-sm text-stone-500">{t('common.loading')}</p>;
  if (!project) {
    return (
      <Alert kind="error">
        {t('book.notFound')}
        {error && <span className="mt-1 block text-xs opacity-80">{error}</span>}
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <a href={routeHref({ name: 'library' })} className="text-sm text-teal-700 hover:underline dark:text-teal-400">
          ← {t('nav.library')}
        </a>
        <h1 data-testid="book-title" className="mt-1 break-words text-xl font-semibold tracking-tight sm:text-2xl">
          {project.title}
        </h1>
        {project.author && <p className="text-sm text-stone-500 dark:text-stone-400">{t('library.byAuthor', { author: project.author })}</p>}
      </div>
      <nav className="flex gap-1 border-b border-stone-200 dark:border-stone-800" aria-label={project.title}>
        {TABS.map((name) => (
          <a
            key={name}
            href={routeHref({ name: 'book', id, tab: name })}
            aria-current={tab === name ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === name
                ? 'border-teal-700 text-teal-800 dark:border-teal-400 dark:text-teal-300'
                : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            {t(`book.tab.${name}`)}
          </a>
        ))}
      </nav>
      {tab === 'setup' && <TranslationSetupPanel project={project} version={version} />}
      {tab === 'read' && <ReaderPanel project={project} version={version} segment={segment} />}
      {tab === 'export' && <ExportPanel project={project} version={version} />}
    </div>
  );
}
