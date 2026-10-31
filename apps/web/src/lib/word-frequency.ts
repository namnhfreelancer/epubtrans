import { type FrequencyList, parseFrequencyList, type WordHintLanguage, wordHintLanguage } from '@epubtrans/core';
import { useEffect, useState } from 'react';

/**
 * Word frequency lists (wordfreq data, CC BY-SA 4.0) are emitted by Vite as separate static files of this origin and
 * fetched only when a book in that language uses Word Wise hints (a few hundred KB each), so the app bundle and the
 * CSP (`connect-src 'self'`) stay as they are.
 */
const LIST_URLS = import.meta.glob<string>('../../../../packages/core/data/wordfreq/*.txt', { query: '?url', import: 'default' });

const urlLoaderFor = (lang: WordHintLanguage) => LIST_URLS[`../../../../packages/core/data/wordfreq/${lang}.txt`];

const cache = new Map<WordHintLanguage, Promise<FrequencyList>>();

/** Loads (once per session) the frequency list of a supported language. A failed load is retried on the next call. */
export function loadFrequencyList(lang: WordHintLanguage): Promise<FrequencyList> {
  let pending = cache.get(lang);
  if (!pending) {
    const loadUrl = urlLoaderFor(lang);
    pending = (async () => {
      if (!loadUrl) throw new Error(`No word frequency list for ${lang}`);
      const res = await fetch(await loadUrl());
      if (!res.ok) throw new Error(`Could not load the ${lang} word frequency list (HTTP ${res.status})`);
      return parseFrequencyList(lang, await res.text());
    })();
    pending.catch(() => cache.delete(lang));
    cache.set(lang, pending);
  }
  return pending;
}

export type FrequencyListState =
  | { status: 'unsupported' }
  | { status: 'loading'; lang: WordHintLanguage }
  | { status: 'ready'; list: FrequencyList }
  | { status: 'error'; message: string };

/** The frequency list for a source language tag, loaded on demand; `enabled: false` loads nothing. */
export function useFrequencyList(sourceLang: string, enabled: boolean): FrequencyListState {
  const lang = wordHintLanguage(sourceLang);
  const [state, setState] = useState<FrequencyListState>(lang ? { status: 'loading', lang } : { status: 'unsupported' });
  useEffect(() => {
    if (!lang) return setState({ status: 'unsupported' });
    if (!enabled) return;
    let live = true;
    setState({ status: 'loading', lang });
    loadFrequencyList(lang).then(
      (list) => live && setState({ status: 'ready', list }),
      (err: unknown) => live && setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [lang, enabled]);
  return state;
}
