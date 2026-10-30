# Code standards

## Language and tooling

- TypeScript with `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (see `tsconfig.base.json`). Avoid `any`; where an unavoidable cast is needed, justify it in a comment.
- Biome is the single formatter and linter (`biome.json`): 2 spaces, single quotes, semicolons, trailing commas, line width 160, organized imports. Run `bun run format` and `bun run lint`.
- Files are small, kebab-case and named after what they hold (`markup-validation.ts`, `project-store.ts`). Split a file when it mixes concerns or passes about 200 lines.
- Comments explain the invariant or the reason, not the history of the change. Do not put plan, phase or ticket ids in code, tests or commit messages.

## Architecture rules

- `packages/core` is environment-agnostic: no DOM globals, no Node-only APIs, no direct `fetch` except through `createProvider`'s default. DOM comes from an injected `DomEnv`.
- Core's public API is `src/index.ts`; apps import only from `@epubtrans/core`.
- Validate at boundaries: project files and IndexedDB rows go through `validateProjectState`; model answers go through `parseSegmentsAnswer` and `validateTranslationMarkup`; CLI flags go through `parseArgs` and `applyRunFlags`.
- Never build XHTML by string concatenation of untrusted text; use the DOM helpers and the injected serializer.
- Every async operation handles failure explicitly: abort and fatal provider errors propagate, retryable ones back off, per-segment failures are recorded in the project.

## Secrets

- API keys live only in the user's browser storage (web) or in an environment variable or key file (CLI). They are sent only to the selected provider endpoint.
- Never accept a key as a command-line value, never log or print it, never write it to a project file, test fixture or error message. Tests that exercise keys assert they do not appear in output.
- Do not commit `.env*` files or real keys; real-model checks use a key from the environment.

## Testing

- New logic gets tests for the happy path and the main failure cases. Use public-domain fixtures only.
- Core: Vitest, with mock `ChatProvider`s for translation logic and fake timers for backoff.
- CLI: `bun test`, driving `run(argv, io)` against a local mock HTTP server; no network or real keys.
- Web: Vitest for logic, Playwright for flows, including a network-log test that the key only goes to the chosen endpoint.
- Exported EPUBs must pass epubcheck with zero errors (CI job `epubcheck`).
- Fix failing tests; do not weaken or skip them.

## Commits and releases

Conventional Commits (`feat`, `fix`, `refactor`, `test`, `build`, `ci`, `docs`, `chore`; `!` for breaking). release-please derives versions and `CHANGELOG.md` from them. Keep commits focused.
