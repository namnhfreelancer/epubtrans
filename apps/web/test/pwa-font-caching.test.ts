import { EMBEDDED_FONT_FILES } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { FONT_ASSET_PATTERN, FONT_CACHE_MAX_ENTRIES, FONT_CACHE_NAME, FONT_RUNTIME_CACHING } from '../pwa-font-caching';

describe('service worker caching of the bundled fonts', () => {
  it('matches built font and license URLs, at the root and under a base path, and nothing else', () => {
    for (const url of [
      'http://localhost:4317/assets/literata-regular-BkY2_Ab3.ttf',
      'https://example.github.io/epubtrans/assets/be-vietnam-pro-bold-x-Y_9.ttf',
      'https://example.github.io/epubtrans/assets/noto-serif-OFL-D3fG-h.txt',
    ]) {
      expect(FONT_ASSET_PATTERN.test(url), url).toBe(true);
    }
    for (const url of [
      'http://localhost:4317/assets/index-AbC123.js',
      'http://localhost:4317/assets/index-AbC123.css',
      'http://localhost:4317/assets/notes-AbC.txt',
      'http://localhost:4317/assets/literata-regular-BkY2.ttf?download=1',
      'http://localhost:4317/fonts/literata-regular.ttf',
      'http://localhost:4317/sw.js',
    ]) {
      expect(FONT_ASSET_PATTERN.test(url), url).toBe(false);
    }
  });

  it('caches first, in a versioned cache that holds every catalog file and stays bounded', () => {
    expect(FONT_RUNTIME_CACHING.handler).toBe('CacheFirst');
    expect(FONT_CACHE_NAME).toMatch(/^epubtrans-fonts-v\d+$/);
    expect(FONT_RUNTIME_CACHING.options).toEqual({
      cacheName: FONT_CACHE_NAME,
      expiration: { maxEntries: FONT_CACHE_MAX_ENTRIES, purgeOnQuotaError: true },
      cacheableResponse: { statuses: [200] },
    });
    expect(FONT_CACHE_MAX_ENTRIES).toBeGreaterThanOrEqual(EMBEDDED_FONT_FILES.length);
    expect(FONT_CACHE_MAX_ENTRIES).toBeLessThanOrEqual(2 * EMBEDDED_FONT_FILES.length);
  });
});
