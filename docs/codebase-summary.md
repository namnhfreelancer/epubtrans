# Codebase summary

Bun workspaces monorepo (`packages/*`, `apps/*`), TypeScript strict, Biome for lint and format, Vitest for `core` (and `web` unit tests), `bun test` for `cli`, Playwright for web end-to-end. Toolchain versions are pinned by `bun.lock` and CI uses Bun 1.3.14.

## Layout

```
.
├── packages/core/            @epubtrans/core: engine (ships TypeScript source, no build output)
│   ├── src/
│   │   ├── types.ts          public data contracts (Project, Segment, ChatProvider, ...)
│   │   ├── index.ts          public API
│   │   ├── dom/              XHTML parse/serialize, HTML -> XHTML, deterministic fragment serializer
│   │   ├── epub/             OPF parsing, EPUB 3 package builder (+ NCX)
│   │   ├── formats/          format detection, MOBI/AZW3 -> EPUB, FB2 -> EPUB
│   │   ├── import/           importBook: detect, normalize, segment
│   │   ├── segment/          split documents into translatable segments
│   │   ├── translate/        batching, prompts, validation, retries, guide, cost estimate
│   │   ├── providers/        OpenAI-compatible and Anthropic adapters, presets
│   │   ├── export/           exportEpub (4 modes), Word Wise hint markup, font packaging, export identifier, attribution page
│   │   ├── export-style/     export styles: validation, presets, CSS generation, embedded font catalog, template files
│   │   ├── word-hints/       Word Wise: frequency lists, lemmatizer, candidate selection, gloss protocol and run, estimate
│   │   ├── project/          .epubtrans save/load, default settings
│   │   ├── lang/             language detection (franc-min)
│   │   └── util/             zip, text encoding, paths, ids
│   ├── data/wordfreq/        word frequency rank lists (wordfreq, CC BY-SA 4.0) for Word Wise hints
│   ├── data/fonts/           embeddable SIL OFL fonts (TrueType subsets) and their licenses
│   ├── third-party/foliate-js/   vendored MOBI parser (MIT) with local patches
│   └── test/                 Vitest suites and public-domain fixtures (EPUB, MOBI, AZW3, FB2)
├── apps/web/                 @epubtrans/web: Vite + React 19 + Tailwind v4 + Dexie PWA, Playwright e2e
├── apps/cli/                 @epubtrans/cli: Bun CLI
│   ├── src/main.ts           entry (signals, exit code)
│   ├── src/run.ts            command dispatch, usage errors
│   ├── src/commands/         translate, resume, sample, hints, export, models, presets
│   ├── src/pipeline.ts       estimate, confirm, translate with saves, export
│   ├── src/args.ts           argv parser (rejects keys on the command line)
│   ├── src/api-key.ts        key resolution
│   ├── src/project-store.ts  atomic writes, throttled project saver
│   ├── src/dom-env.ts        linkedom DomEnv + XMLSerializer shim
│   └── test/                 argv, key resolution, translate/resume against a mock server
├── scripts/                  install_unix.sh, install_windows.ps1, build-cli.ts, smoke-cli-binary.ts, generate-word-frequency-lists.ts, subset-embedded-fonts.py
├── .github/workflows/        ci.yml, pages.yml, release.yml
├── release-please-config.json, .release-please-manifest.json
└── docs/
```

## Commands (repository root)

| Command | What it does |
|---------|--------------|
| `bun install` | Install workspace dependencies |
| `bun run typecheck` | `tsc` in every workspace that defines `typecheck` |
| `bun run lint` | `biome check .` |
| `bun run format` | `biome format --write .` |
| `bun run test` | Test script of every workspace (Vitest for core, `bun test` for cli) |
| `bun run build` | Core type check, CLI host binary into `dist/`, web production build |
| `bun scripts/build-cli.ts --all` | Binaries for all five release targets plus `dist/SHA256SUMS` |
| `bun scripts/smoke-cli-binary.ts` | Runs the compiled binary: `--version`, `presets`, `export` in every mode, with hints and with a `--style-file` that embeds a font, `hints` (embedded frequency list) |
| `bun scripts/generate-word-frequency-lists.ts` | Regenerates `packages/core/data/wordfreq/*.txt` from wordfreq (network; not run in CI) |
| `python3 -I scripts/subset-embedded-fonts.py SRC packages/core/data/fonts` | Rebuilds the embeddable font subsets from Google Fonts sources (needs fontTools; not run in CI) |

`bun run --filter '*' <script>` skips workspaces that do not define the script.

## Test fixtures

`packages/core/test/fixtures` holds public-domain books used by core and CLI tests: `a-modest-proposal.epub` (Project Gutenberg #1080), the same book as `.mobi` and `.azw3`, and `aesop-fables.fb2`. `test/epub2-fixture.ts` generates a small valid EPUB 2 book (OPF 2.0, NCX, XHTML 1.1); `export:samples` exports all of them, including every style preset and a styled export with embedded fonts and the attribution page, for epubcheck in CI. The CLI tests start a local OpenAI-compatible HTTP server (`Bun.serve` on an ephemeral port) and drive `translate`, interruption, `resume` and `export` against it.

## Key dependencies

`fflate` (zip), `franc-min` (language detection), `linkedom` (DOM for CLI and tests), vendored foliate-js `mobi.js`. The web app adds React, Tailwind, Dexie and vite-plugin-pwa.
