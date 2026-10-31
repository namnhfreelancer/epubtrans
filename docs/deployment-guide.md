# Deployment guide

Everything ships from GitHub Actions (`.github/workflows/`). There are no servers to run.

## Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | pull request, push to `main` | `check`: install with the frozen lockfile, typecheck, lint, test, build, smoke-test the compiled CLI. `e2e`: Playwright (Chromium) for the web app. `epubcheck`: exports sample EPUBs (`export:samples` in core) and validates each `packages/core/test-output/*.epub` with epubcheck 5.4.0 (checksum-pinned), failing on any error. |
| `pages.yml` | push to `main`, manual | Builds `apps/web` with `BASE_PATH=/epubtrans/` and deploys `apps/web/dist` to GitHub Pages. |
| `release.yml` | push to `main` | Runs release-please, which creates the release as a draft; when a release is created, compiles the CLI for five targets, writes `SHA256SUMS`, uploads everything to the release and only then publishes it as the latest release. |

## One-time repository setup

- Settings, Pages: set the source to "GitHub Actions".
- Settings, Actions, General: allow GitHub Actions to create and approve pull requests (release-please needs it to open the release PR).
- Pull requests opened by `GITHUB_TOKEN` do not trigger other workflows. To run CI on release PRs, give the release-please step a personal access token (`token:` input) instead.

## Web (GitHub Pages)

The site is served under `/epubtrans/`, so the build must run with `BASE_PATH=/epubtrans/`. To build locally the same way:

```bash
BASE_PATH=/epubtrans/ bun run --filter @epubtrans/web build
```

If the repository later moves to a custom domain at the root, change `BASE_PATH` in `pages.yml` to `/`.

Live URL: <https://namnhfreelancer.github.io/epubtrans/>. The origin `namnhfreelancer.github.io` is shared with the owner's other GitHub Pages sites. A key saved with "remember key" sits in `localStorage` for that whole origin, so other sites on it can read it. The README privacy section tells users to leave the option unchecked on shared machines. A dedicated origin (a custom subdomain for this project) would remove the sharing; it also needs `BASE_PATH=/`.

## Releases and versions

Versioning is driven by Conventional Commits through release-please (manifest mode, `release-type: node`, root package `epubtrans`, tags like `v3.0.0`). The root `package.json` `version` and `.release-please-manifest.json` are the source of truth; the CLI prints the root version.

The first release of the TypeScript rewrite, **3.0.0**, was pinned with a temporary `"release-as": "3.0.0"` in `release-please-config.json`; that pin has been removed now that v3.0.0 is out.

Versions are now computed from commits: `fix` gives a patch release, `feat` a minor release, and a `!` commit a major release.

### What a release produces

On merging the release PR, release-please tags `vX.Y.Z` and creates the GitHub Release as a **draft** (`"draft": true` and `"force-tag-creation": true` in `release-please-config.json`; GitHub does not create the tag for a draft until it is published, so the tag is forced, otherwise release-please would lose track of the previous release). The `binaries` job then checks out that tag and runs `bun scripts/build-cli.ts --all`, which uses `bun build --compile` for `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64` and `bun-windows-x64`, and attaches:

```
epubtrans-linux-x64   epubtrans-linux-arm64   epubtrans-darwin-x64
epubtrans-darwin-arm64   epubtrans-windows-x64.exe   SHA256SUMS
```

After the upload, the last step runs `gh release edit "$TAG" --draft=false --latest`. Until then the release is invisible, so `releases/latest/download/...` never points at a release without binaries. If the build or upload fails, the draft stays unpublished: fix the cause and re-run the failed job, or publish it by hand once the assets are attached.

`scripts/install_unix.sh` and `scripts/install_windows.ps1` install the latest release and verify the binary against `SHA256SUMS`.

## Local verification

```bash
bun run typecheck && bun run lint && bun run test && bun run build   # build also compiles the host binary
bun scripts/smoke-cli-binary.ts                                      # run that binary offline
bun scripts/build-cli.ts --all                                       # all targets (downloads Bun runtimes once)
```

Workflow files can be linted with `actionlint` (for example `docker run --rm -v "$PWD/.github/workflows:/wf:ro" rhysd/actionlint /wf/ci.yml /wf/pages.yml /wf/release.yml`) and the installer with `shellcheck scripts/install_unix.sh`.

## Rollback

- Web: re-run the `pages.yml` workflow on the last good commit, or revert the offending commit on `main`.
- CLI: delete the faulty GitHub Release assets or the release; the installers read "latest", so users get the previous release again. A specific version can always be installed with `--version vX.Y.Z`.
