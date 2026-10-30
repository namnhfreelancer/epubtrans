import { expect, test } from '@playwright/test';

test.describe('installable PWA', () => {
  test.use({ serviceWorkers: 'allow' });

  test('serves a valid manifest, registers a service worker and works offline', async ({ page, request }) => {
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();

    // Strict CSP: no inline script, provider calls limited to https and localhost.
    const csp = (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toMatch(/connect-src 'self' https: http:\/\/localhost:\*/);

    // Manifest with icons.
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifestUrl = new URL(href ?? '', page.url()).toString();
    const manifest = (await (await request.get(manifestUrl)).json()) as {
      name: string;
      short_name: string;
      display: string;
      theme_color: string;
      start_url: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(manifest.name).toContain('epubtrans');
    expect(manifest.short_name).toBe('epubtrans');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0f766e');
    expect(manifest.start_url).toBeTruthy();
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, manifestUrl).toString());
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type']).toContain(icon.type);
    }

    // Service worker registered, active, and precaching the app shell.
    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { script: registration.active?.scriptURL ?? '', scope: registration.scope };
    });
    expect(worker.script).toMatch(/\/sw\.js$/);
    expect(worker.scope).toBe(new URL('/', page.url()).toString());
    await expect
      .poll(() =>
        page.evaluate(async () => {
          for (const name of await caches.keys()) {
            const urls = (await (await caches.open(name)).keys()).map((r) => r.url);
            if (urls.some((u) => u.includes('index.html')) && urls.some((u) => /\/assets\/index-.*\.js/.test(u))) return true;
          }
          return false;
        }),
      )
      .toBe(true);

    // The precached shell loads without network.
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await page.context().setOffline(false);

    expect(cspViolations).toEqual([]);
  });
});
