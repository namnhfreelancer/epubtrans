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
- `src/preview/` — the Preview tab (foliate-js reader vendored under `third-party/foliate-js/`, MIT; its strings are in `preview-messages.ts`).
- `e2e/` — Playwright specs. Provider calls go to `https://mock-provider.test/v1`, intercepted with `page.route`.

## Reader: finding and fixing failed segments

- The chapter list flags chapters with failed segments (icon, count and an accessible label) and shows "N errors in M chapters" above it.
- "Previous error" / "Next error" (keys `[` and `]`, ignored while typing in a field) move across chapters, centre the segment, focus and flash it, and show "Error 3 of 17". Navigation stops at the first and last error (the buttons disable) instead of wrapping.
- Each jump rewrites the URL to `#/book/<id>/read/<segmentId>`, so a reload or a shared link opens the same segment.
- "Show only errors" limits the chapter list and the segments to failed ones. "Retry all failed" starts the same job as "Retry failed segments" on the Translate tab (`useStartTranslation`), so one job per book and the sample/job locks apply; counts update as segments finish.

## Preview tab

- Renders the EPUB that Export would produce, in the chosen layout (the mode list comes from core's `EXPORT_MODES`), with foliate-js: table of contents, previous/next page (buttons and arrow keys), progress, search.
- It is built with `exportEpub(project, mode, env, { preview: true })`, which keeps `data-et-id` on segment blocks and adds `et-error` / `et-pending` to failed and untranslated ones. Downloads never use this option.
- Clicking a paragraph opens `#/book/<id>/read/<segmentId>`. "Show issues" outlines failed segments (with a badge) and, more lightly, untranslated ones.
- Device (Kindle 6.8", phone, tablet, desktop), theme (light, sepia, dark), pages or scrolling and font size are preview-only: kept in `localStorage` (`epubtrans:preview-settings`) and applied as reader CSS and layout attributes on foliate's view, never written into an export.
- Project changes (edits, a running job, edits in another tab) rebuild the preview after 0.7 s of quiet (at most every 4 s while changes keep coming) and reopen it on the segment that was on screen. A change that leaves the export inputs untouched does not rebuild.

## Several tabs on one book

Tabs of the same origin share IndexedDB but each holds its own in-memory project.

- Only one tab at a time can translate a book: a job holds the Web Lock `epubtrans:job:<projectId>` (`src/lib/cross-tab-job-lock.ts`), and so does a sample run (it is a paid job too). Other tabs poll `navigator.locks.query()` (every second, on focus, and when a tab announces a job start or end). While the lock is held elsewhere they disable Start, the sample buttons and the reader's "Retry all failed", show a notice, and lock Edit/Retranslate in the reader. A start that loses the race for the lock resolves `busy-elsewhere` and shows the same notice. Browsers without `navigator.locks` run jobs without this guard.
- Job results are saved with compare-and-set (`saveSegmentIfUnchanged`): a segment is written only if its stored status and translation still match what the job last saw. An edit or retranslation saved meanwhile in any tab wins, and the job copies it into its own in-memory segment.
- Every segment write is announced on the BroadcastChannel `epubtrans:<projectId>` (ids only, in `src/lib/cross-tab-channel.ts`). Other tabs re-read that segment from IndexedDB and refresh their views.

## Security notes

- The production build injects a Content Security Policy meta tag: no inline scripts, provider calls limited to `https:` and `http://localhost`. For the preview it allows `frame-src blob:`, `style-src 'unsafe-inline' blob:` and `font-src blob:` (foliate renders each section as a blob: document that inherits the policy; see `vite.config.ts`). Scripts stay `'self'` only; in addition foliate skips script resources and every previewed section document carries its own `script-src 'none'` policy. The preview's copy of each section also loses `<meta http-equiv="refresh">` and prefetch/preconnect/preload `<link>` hints (they would navigate the frame or reach the network despite the policy), and links in a book to http(s) or mailto addresses open in a new tab with `noopener,noreferrer`; other link schemes are ignored.
- Segment markup from books and models is reduced to attribute-free inline formatting before it is displayed.
- The API key is kept in memory unless "Remember key on this device" is checked (then it is stored in `localStorage`).
- Service workers (offline use, install) need a secure context: HTTPS or `localhost`.
