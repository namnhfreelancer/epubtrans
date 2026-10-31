import { EMBEDDED_FONT_FILES } from '@epubtrans/core';

/**
 * Bundled OFL fonts (and their licenses) that an export style can embed. Vite emits them as separate static files of
 * this origin (`font-src`/`connect-src 'self'`), outside the precached app shell, and they are fetched only when an
 * export or a preview embeds that font. A loaded file is kept for the session, and the service worker keeps it for
 * offline use (`pwa-font-caching.ts`).
 */
const FILE_URLS = import.meta.glob<string>(['../../../../packages/core/data/fonts/*.ttf', '../../../../packages/core/data/fonts/*.txt'], {
  query: '?url',
  import: 'default',
});

const cache = new Map<string, Promise<Uint8Array>>();

/** Loader handed to core's export. Only names from the core catalog are fetched; a failed load is retried next time. */
export function loadFontFile(file: string): Promise<Uint8Array> {
  let pending = cache.get(file);
  if (!pending) {
    const loadUrl = EMBEDDED_FONT_FILES.includes(file) ? FILE_URLS[`../../../../packages/core/data/fonts/${file}`] : undefined;
    pending = (async () => {
      if (!loadUrl) throw new Error(`Unknown font file: ${file}`);
      const res = await fetch(await loadUrl());
      if (!res.ok) throw new Error(`Could not load the font file ${file} (HTTP ${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    })();
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  return pending;
}
