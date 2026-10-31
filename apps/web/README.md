# @epubtrans/web

Static, bring-your-own-key web app for epubtrans: import a DRM-free EPUB, MOBI, AZW3 or FB2 book, translate it in the browser with your AI provider, edit the result and export a bilingual EPUB. There is no backend; books and progress live in IndexedDB, and the API key is only sent to the selected provider.

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Vite dev server |
| `bun run build` | Production build into `dist/` (`BASE_PATH=/epubtrans/` for GitHub Pages; default `/`) |
| `bun run preview` | Serves `dist/` on port 4317 |
| `bun run typecheck` | `tsc` for the app and the Node-side configs/tests |
| `bun run test` | Vitest unit tests (`test/`) |
| `bun run test:e2e` | Playwright (Chromium) against a fresh build served by `vite preview` on port 4317 |
| `bun run icons` | Regenerates PNG icons from the SVG sources (needs `rsvg-convert`) |

## Layout

- `src/lib/` — persistence (`project-database.ts`, `project-repository.ts`), in-memory project store, translation jobs, provider configuration and API key storage.
- `src/components/` — UI by screen: `library/`, `settings/`, `setup/`, `reader/`, `export/`, shared `ui/`.
- `src/i18n/` — English and Vietnamese dictionaries; `messages-vi.ts` is typed against the English key set.
- `e2e/` — Playwright specs. Provider calls go to `https://mock-provider.test/v1`, intercepted with `page.route`.

## Reader: finding and fixing failed segments

- The chapter list flags chapters with failed segments (icon, count and an accessible label) and shows "N errors in M chapters" above it.
- "Previous error" / "Next error" (keys `[` and `]`, ignored while typing in a field) move across chapters, centre the segment, focus and flash it, and show "Error 3 of 17". Navigation stops at the first and last error (the buttons disable) instead of wrapping.
- Each jump rewrites the URL to `#/book/<id>/read/<segmentId>`, so a reload or a shared link opens the same segment.
- "Show only errors" limits the chapter list and the segments to failed ones. "Retry all failed" starts the same job as "Retry failed segments" on the Translate tab (`useStartTranslation`), so one job per book and the sample/job locks apply; counts update as segments finish.

## Security notes

- The production build injects a Content Security Policy meta tag: no inline scripts, provider calls limited to `https:` and `http://localhost`.
- Segment markup from books and models is reduced to attribute-free inline formatting before it is displayed.
- The API key is kept in memory unless "Remember key on this device" is checked (then it is stored in `localStorage`).
- Service workers (offline use, install) need a secure context: HTTPS or `localhost`.
