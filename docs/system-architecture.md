# System architecture

epubtrans is a Bun-workspaces TypeScript monorepo. One engine (`@epubtrans/core`) is shared by a browser app and a CLI. There is no backend.

```
            +--------------------+       +------------------+
            |  apps/web          |       |  apps/cli        |
            |  React, IndexedDB  |       |  Bun binary      |
            |  DOM: browser      |       |  DOM: linkedom   |
            +---------+----------+       +---------+--------+
                      |      DomEnv, fetch, storage    |
                      +--------------+-----------------+
                                     v
                          +----------------------+
                          |  packages/core       |
                          |  import, segment,    |
                          |  translate, export,  |
                          |  project file        |
                          +----------+-----------+
                                     | HTTPS, key only to the chosen endpoint
                                     v
              Anthropic | OpenAI | Gemini | OpenRouter | DeepSeek | custom
```

## Core pipeline (`packages/core`)

1. **Import** (`import/import-book.ts`). `formats/detect-format.ts` recognizes EPUB, MOBI, AZW3 and FB2 from the bytes and file name. MOBI/AZW3 are converted by the vendored foliate-js parser (`third-party/foliate-js/mobi.js`, with an injected DOM), FB2 by an own converter. Everything is normalized into one in-memory EPUB package, so the later stages have a single path. DRM (MOBI encryption flag, EPUB `rights.xml` or non-font `encryption.xml`) is detected and rejected with a clear error.
2. **Segmentation** (`segment/segment-document.ts`). Block-level text in each content document is split into segments with ids `c{chapter}-{n}`; segment markers (`data-et-id`) are written into the normalized EPUB. Code, `pre`, math, SVG and similar blocks are skipped. The table of contents becomes chapter 0 (`TOC_CHAPTER_TITLE`) so TOC titles are translated too.
3. **Project** (`types.ts`). A `Project` holds settings, chapters with segments (`pending`, `translated`, `reviewed`, `error`) and the normalized `sourceEpub` bytes. `project/project-file.ts` saves it as a `.epubtrans` zip (`project.json` + `source.epub`) and validates untrusted state on load (`validateProjectState`, also used for IndexedDB rows).
4. **Translation** (`translate/`).
   - `translate-project.ts` translates every `pending` or `error` segment (that is what makes runs resumable), in batches of up to about 1500 source tokens, with a configurable number of parallel requests (1 to 16). With `twoPass`, a review pass follows over every `translated` segment.
   - Protocol (`prompt-protocol.ts`): system prompt = stable prefix (role, language pair, guideline, glossary) plus rules; user message = JSON `{"segments":[{"id","html"}]}`; the model must answer the same JSON shape.
   - `markup-validation.ts` checks the answer: same id set, same multiset of inline tags (name and attributes), balanced closing tags. A rejected batch is split and retried; valid segments from a partly wrong answer are kept. This also blocks injected attributes such as `javascript:` hrefs.
   - `retry-with-backoff.ts` retries 429, 5xx and network errors with exponential backoff and jitter (honors `Retry-After`, 5 attempts). Fatal errors (401, 403, 404) and five consecutive 4xx responses stop the run; other failures mark segments `error`.
   - `generate-guide.ts` drafts a book-specific guideline and glossary from a sample spread across the book. `estimate-cost.ts` estimates tokens for the remaining work (chars/4 for Latin, chars/1.5 for CJK) and USD from user-supplied prices. `guideline-presets.ts` holds the `general`, `fiction`, `technical` and `psychology` starting guidelines.
5. **Export** (`export/export-epub.ts`). Rebuilds the EPUB from `sourceEpub`: removes segment markers, places translations per mode (`bilingual`, `bilingual-translation-first`, `translation-only`), sets `lang`/`xml:lang`, links a small stylesheet that fades the source text, and writes `mimetype` first and stored. Untranslated segments keep their source text. Documents are serialized with the injected `XMLSerializer`, never with `innerHTML`, so the XHTML stays well formed. Translations go to the primary rendition; the other renditions of a multi-rendition book are kept and sanitized. Exports never carry active content, whether it comes from the model or the source book: `prune-package-files.ts` drops files no package document references (keeping `mimetype`, `META-INF/**`, every rootfile in `container.xml`, and each rendition's manifest items and `<link>` targets) plus any XSLT. `strip-active-content.ts` then sanitizes every markup file, recognized by media type, by extension, or by content (any kept file whose first non-whitespace character is `<`, whatever its name or declared type). It removes scripts, `on*` attributes, `javascript:`-style URLs, `<template>`, frames, embeds, and comments and processing instructions inside the document. It unwraps `<object>` to its fallback content and replaces markup that fails to parse with a safe stand-in. A file with any `xml-stylesheet` instruction is rewritten, keeping only instructions whose parsed `type` is exactly `text/css` (`xml-prolog.ts`).

## Environment injection

Core never touches DOM globals. Callers pass `DomEnv = { DOMParser, XMLSerializer }`: the browser natives in the web app, `linkedom` in the CLI and tests (`apps/cli/src/dom-env.ts` adds a small `XMLSerializer` shim because linkedom nodes serialize themselves). HTTP goes through `fetch`, injectable in `createProvider`.

## Providers (`providers/`)

`ChatProvider` has `listModels` and `chat`. One OpenAI-compatible adapter (Chat Completions over `fetch`) serves OpenAI, Gemini, OpenRouter, DeepSeek and custom URLs; Anthropic uses a native Messages adapter (header `anthropic-dangerous-direct-browser-access: true` for browser CORS, plus prompt caching). Models come from `GET {baseURL}/models` (Anthropic: `/v1/models`). The API key is attached only to requests for the configured base URL.

## Web app (`apps/web`)

Vite, React 19, Tailwind v4, Dexie (IndexedDB) and vite-plugin-pwa; UI strings in a small typed dictionary (Vietnamese and English). Books, settings and segment state are persisted in IndexedDB as translation proceeds, so a reload resumes. Features: multi-book library, side-by-side reader and editor with per-segment re-translation, glossary and guideline editor, cost estimate, export in the three modes, import and export of `.epubtrans` files. Deployed as static files to GitHub Pages under `/epubtrans/`. See `apps/web` for the current structure.

Several tabs on one book: a translation job holds the Web Lock `epubtrans:job:<projectId>` for its whole run, so other tabs cannot start one and lock Edit/Retranslate; the job saves each segment with compare-and-set inside a Dexie transaction (an edit saved from another tab wins), and segment changes are announced on the BroadcastChannel `epubtrans:<projectId>` so open tabs refresh. Details: `apps/web/README.md`.

## CLI (`apps/cli`)

`src/run.ts` dispatches `translate`, `resume`, `export`, `models` and `presets` (`src/commands/`). Shared steps live in `src/pipeline.ts`: persist the project, print the estimate and ask for confirmation (Ctrl-C at the prompt exits with 130, see `prompt.ts`), then look up prices, optionally generate the guide, run `translateProject` with throttled atomic saves of the project file (`project-store.ts`), flush on Ctrl-C or error, export the EPUB. API keys come only from `--api-key-file`, `EPUBTRANS_API_KEY` or the provider's own variable (`api-key.ts`); a key flag on argv is rejected. `EPUBTRANS_API_KEY` is skipped when a provider other than the default (`DEFAULT_PROVIDER_ID` in `settings.ts`, currently `openai`) comes only from the project file (no `--provider` or `--base-url` on that run), so a shared file cannot pick who receives the generic key; the CLI then fails with instructions. The default provider is exempt because a fresh import already sends the generic key there, which keeps "run the same command again" and `resume` working. `bun build --compile` produces single binaries (`scripts/build-cli.ts`).

## Security and privacy model

- No server and no telemetry: books and keys stay on the user's device.
- The key is sent only to the selected provider endpoint (Playwright network-log test covers the web app; the CLI builds the provider from the same core code).
- Model output is untrusted: it is validated against the source markup before it is stored or exported.
- Project files contain no key. Project JSON and IndexedDB rows are validated before use.
- Web: the key is memory-only unless the user ticks "remember key", which writes it to `localStorage` on the Pages origin `namnhfreelancer.github.io`. That origin is shared with the owner's other GitHub Pages sites, so any script served there could read it; documented in the README privacy section. Serving the app from a dedicated origin (for example a custom subdomain) would remove the sharing.
- CLI: the provider endpoint is never read from a project file (shared files could otherwise redirect the key). Presets use their own endpoint unless `--base-url` is passed on that run; `custom` requires `--base-url` on every run. Every request to the provider, including the OpenRouter price lookup and the `--generate-guide` call, happens only after the cost confirmation.

## Release flow

Conventional commits on `main` drive release-please. Merging the release PR creates a tag and GitHub Release; the same workflow compiles the CLI binaries and uploads them with `SHA256SUMS`. Details in [deployment-guide.md](deployment-guide.md).
