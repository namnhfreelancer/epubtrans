import type { VitePWAOptions } from 'vite-plugin-pwa';

type RuntimeCaching = NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number];

/**
 * Name of the service worker's cache for the bundled export fonts. Versioned: change the suffix when the caching rule
 * changes in a way old entries must not survive.
 */
export const FONT_CACHE_NAME = 'epubtrans-fonts-v1';

/**
 * Most font files kept: the catalog has 12 font files and 4 license texts (about 1.4 MB together), so every font fits
 * with room for one font update, while files of replaced builds are evicted (least recently used) instead of piling up.
 */
export const FONT_CACHE_MAX_ENTRIES = 24;

/**
 * Built URLs of the bundled fonts and their licenses: `<base>assets/<name>-<hash>.ttf` and
 * `<base>assets/<family>-OFL-<hash>.txt`. Workbox matches a regular expression only against same-origin URLs unless it
 * matches from the URL's first character, which this one cannot, so other origins are never cached.
 */
export const FONT_ASSET_PATTERN = /\/assets\/[^/?#]+\.ttf$|\/assets\/[^/?#]+-OFL-[^/?#]+\.txt$/;

/**
 * Runtime caching of the bundled export fonts. They stay out of the precache (most people never embed a font, and the
 * catalog is about 1.4 MB), but a font fetched once is kept, cache first, so styled exports and previews that use it
 * also work offline later. Hashed file names make the files immutable, so a cached copy never goes stale.
 */
export const FONT_RUNTIME_CACHING: RuntimeCaching = {
  urlPattern: FONT_ASSET_PATTERN,
  handler: 'CacheFirst',
  options: {
    cacheName: FONT_CACHE_NAME,
    expiration: { maxEntries: FONT_CACHE_MAX_ENTRIES, purgeOnQuotaError: true },
    cacheableResponse: { statuses: [200] },
  },
};
