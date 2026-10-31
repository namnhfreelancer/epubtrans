import { AppHeader } from './components/app-header';
import { NoticeToasts } from './components/notice-toasts';
import { I18nProvider, useI18n } from './i18n/i18n-context';
import { useRoute } from './lib/hash-route';
import { BookPage } from './pages/book-page';
import { LibraryPage } from './pages/library-page';
import { SettingsPage } from './pages/settings-page';
import { useWebMcpTools } from './webmcp/use-webmcp-tools';

function Shell() {
  const route = useRoute();
  const { t } = useI18n();
  // Tools for in-browser AI agents (WebMCP); does nothing in browsers without `document.modelContext`.
  useWebMcpTools();
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader route={route} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {route.name === 'library' && <LibraryPage />}
        {route.name === 'settings' && <SettingsPage />}
        {route.name === 'book' && <BookPage key={route.id} id={route.id} tab={route.tab} segment={route.segment} />}
      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-6 text-xs text-stone-500 dark:text-stone-400">{t('app.privacy')}</footer>
      <NoticeToasts />
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
