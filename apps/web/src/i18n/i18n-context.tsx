import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { browserStorage, readString, writeString } from '../lib/safe-storage';
import { isLocale, type Locale, localeFromLanguages, type Translate, translate } from './translate-message';

const STORAGE_KEY = 'epubtrans:locale';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  const stored = readString(browserStorage(), STORAGE_KEY);
  if (isLocale(stored)) return stored;
  return localeFromLanguages(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeString(browserStorage(), STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
