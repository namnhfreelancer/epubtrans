# Contributing to epubtrans

Thanks for helping out. This document covers the workflow; architecture and conventions live in [docs/](docs/).

## Getting started

1. Fork the repository on GitHub and clone your fork:
   ```bash
   git clone https://github.com/<your-user>/epubtrans.git
   cd epubtrans
   ```
2. Create a branch for your change:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development environment

Install [Bun](https://bun.sh) 1.3 or newer, then install dependencies from the repository root:

```bash
bun install
```

Workspaces: `packages/core` (engine), `apps/web` (browser app), `apps/cli` (command line). See [docs/codebase-summary.md](docs/codebase-summary.md).

## Making changes

1. Make your changes in your feature branch and add or update tests.
2. Run the same checks CI runs:
   ```bash
   bun run typecheck
   bun run lint        # Biome; `bun run format` fixes formatting
   bun run test
   bun run build
   ```
3. Changes to the web app also need the end-to-end suite (`bun run --filter @epubtrans/web test:e2e`, requires `bunx playwright install chromium` once).
4. Changes to EPUB output should be checked with [epubcheck](https://www.w3.org/publishing/epubcheck/); CI does this for the exported fixtures.

## Committing changes

Use [Conventional Commits](https://www.conventionalcommits.org/); releases and the changelog are generated from them by release-please:

```
feat(cli): add --dry-run to translate
fix(core): keep nested inline tags when splitting a batch
feat!: change the project file schema
```

`feat` produces a minor release, `fix` a patch release, and `!` or a `BREAKING CHANGE:` footer a major release.

## Submitting a pull request

1. Push your branch to your fork.
2. Open a pull request against `main` and describe what changed and why.
3. Make sure CI is green.

## Code review

Maintainers review pull requests and may ask for changes. Push follow-up commits to the same branch; a maintainer merges once approved.

## Coding standards

See [docs/code-standards.md](docs/code-standards.md). In short: TypeScript strict, Biome formatting, small kebab-case modules, no DOM globals in `packages/core`, and no secrets in code, logs or test fixtures.

## Reporting issues

Use the GitHub issue tracker. Describe the problem, the steps to reproduce it, the book format (never attach a book you may not share), the provider and model, and your browser or CLI version (`epubtrans --version`). Never paste an API key.

Thank you for contributing to epubtrans.
