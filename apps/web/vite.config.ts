import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Deploy base path: `/` locally, `/epubtrans/` on GitHub Pages (set through BASE_PATH). */
function basePath(raw: string | undefined): string {
  const value = (raw ?? '/').trim() || '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

/**
 * Content Security Policy for the production build. Inline scripts are blocked; provider calls may go to
 * any https origin (custom base URLs vary) or to a local server. Dev mode needs Vite's inline preamble,
 * so the meta tag is only injected at build time.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'epubtrans-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  };
}

export default defineConfig({
  base: basePath(process.env.BASE_PATH),
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'epubtrans — bilingual book translator',
        short_name: 'epubtrans',
        description: 'Translate DRM-free EPUB, MOBI, AZW3 and FB2 books into bilingual EPUB in your browser with your own AI API key.',
        theme_color: '#0f766e',
        background_color: '#fafaf9',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // autoUpdate: a new worker takes over open tabs immediately, so the app works offline after the first visit.
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
  },
});
