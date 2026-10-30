import { useI18n } from '../i18n/i18n-context';
import { isLocale, LOCALES } from '../i18n/translate-message';
import { type Route, routeHref } from '../lib/hash-route';

function NavLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-teal-700/10 text-teal-800 dark:bg-teal-400/10 dark:text-teal-300'
          : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800'
      }`}
    >
      {children}
    </a>
  );
}

export function AppHeader({ route }: { route: Route }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <a href={routeHref({ name: 'library' })} className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
          <span className="text-lg font-semibold tracking-tight">epubtrans</span>
          <span className="hidden text-sm text-stone-500 md:inline dark:text-stone-400">{t('app.tagline')}</span>
        </a>
        <nav className="ml-auto flex items-center gap-1">
          <NavLink href={routeHref({ name: 'library' })} active={route.name !== 'settings'}>
            {t('nav.library')}
          </NavLink>
          <NavLink href={routeHref({ name: 'settings' })} active={route.name === 'settings'}>
            {t('nav.settings')}
          </NavLink>
          <label className="sr-only" htmlFor="ui-locale">
            {t('nav.language')}
          </label>
          <select
            id="ui-locale"
            data-testid="locale-switcher"
            value={locale}
            onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}
            className="ml-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900"
          >
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </nav>
      </div>
    </header>
  );
}
