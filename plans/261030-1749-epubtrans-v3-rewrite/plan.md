# epubtrans v3 rewrite — plan

Status: in progress · Issue: namnhfreelancer/epubtrans#1 · Integration branch: `feat/v3-rewrite`

## Objective
Rewrite epubtrans as a TypeScript monorepo (`packages/core`, `apps/web`, `apps/cli`): a BYOK web app running 100% in the browser on GitHub Pages (base path `/epubtrans/`), plus a Bun single-binary CLI sharing the same core, translating DRM-free EPUB/MOBI/AZW3/FB2 into bilingual EPUB through an OpenAI-compatible adapter with provider presets.

## Done means (contract — do not change)
1. Old Go code removed; TS monorepo core/web/cli; typecheck, lint, test, build pass in CI.
2. Web live on GitHub Pages (`/epubtrans/`), auto-deployed by GitHub Actions on merge to main.
3. Reads DRM-free EPUB, MOBI, AZW3, FB2; tests per format with public-domain fixtures.
4. Provider presets (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek, Custom URL); models listed from `/models`, manual entry fallback.
5. Any language pair + source auto-detect; preserves inline formatting; translates TOC/titles; retry/backoff; configurable concurrency.
6. Auto-generated, editable glossary + style guideline; 2-pass review toggle; token/cost estimate before translating.
7. Progress persisted in IndexedDB; reload resumes without re-translating finished segments.
8. Side-by-side reader/editor with per-segment retranslate; export EPUB in 3 modes; output passes `epubcheck` with zero errors.
9. Multi-book library; export/import project file; CLI resumes from that project file.
10. CLI single binaries for Linux/macOS/Windows attached to GitHub Release.
11. UI in Vietnamese and English; installable PWA.
12. API key only sent to the selected provider endpoint (Playwright network-log test).
13. Real end-to-end translation of one public-domain chapter with a real key, exported to a valid EPUB.
14. README and docs updated.

Out of scope: backend server, accounts, payments, DRM removal, PDF/DOCX/TXT input, non-EPUB output, custom domain setup, native mobile app, npm publish.

## Decisions (made by orchestrator)
- Toolchain: Bun workspaces, TypeScript strict, Biome (lint+format), Vitest (core/web unit), Playwright (web e2e). Reason: one runtime for workspaces, tests and `bun build --compile`.
- Web: Vite + React 19 + Tailwind v4 + Dexie (IndexedDB) + vite-plugin-pwa. i18n: tiny typed dictionary (vi, en), no library.
- Core is environment-agnostic: it never touches globals for DOM. Callers inject `{ DOMParser, XMLSerializer }` (browser natives; `linkedom` in CLI/tests).
- All input formats are normalized to an in-memory EPUB package first (MOBI/AZW3/FB2 → EPUB via foliate-js parsers, vendored under MIT), so segmentation/export has one path.
- Provider layer: one OpenAI-compatible chat-completions adapter (fetch, streaming not required) used by OpenAI, Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`), OpenRouter, DeepSeek, Custom URL. Anthropic preset uses a small native Messages adapter (`anthropic-dangerous-direct-browser-access: true`) because browser CORS is documented for the native API but not for its compat endpoint; it also enables prompt caching.
- Model list: `GET {baseURL}/models` (Anthropic: `/v1/models`); free-text model input always available.
- Export modes: `bilingual` (source, then translation; source visually faded), `bilingual-translation-first` (translation, then faded source), `translation-only`.
- Cost estimate: token count approximated (chars/4 for Latin, chars/1.5 for CJK), multiplied by user-entered USD per 1M in/out tokens; OpenRouter preset pre-fills prices from its `/models` `pricing`. No hardcoded price table.
- Source language auto-detect: `franc-min` on sampled text, user can override.
- Project file: `.epubtrans` = zip containing `project.json` (schema-versioned state) + `source.epub` (normalized package).
- Prompt presets carried over from v2: `general`, `fiction`, `technical`, `psychology` as starting guidelines.
- Live URL: Pages resolves to `http://namnhfreelancer.me/epubtrans/` (account custom domain); github.io redirects there.

## Core contracts (`packages/core`, package name `@epubtrans/core`)
```ts
type DomEnv = { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer };
type SegmentStatus = 'pending' | 'translated' | 'reviewed' | 'error';
interface Segment { id: string; sourceHtml: string; sourceText: string; translationHtml?: string; status: SegmentStatus; error?: string; }
interface Chapter { href: string; title: string; segments: Segment[]; }
interface GlossaryEntry { term: string; translation: string; note?: string; }
interface ProjectSettings { sourceLang: string /* BCP47 or 'auto' */; targetLang: string; providerId: string; baseURL: string; model: string; concurrency: number; twoPass: boolean; guideline: string; glossary: GlossaryEntry[]; priceInPerM?: number; priceOutPerM?: number; }
interface Project { schemaVersion: 1; id: string; title: string; author?: string; createdAt: string; updatedAt: string; settings: ProjectSettings; chapters: Chapter[]; sourceEpub: Uint8Array; }

importBook(bytes: Uint8Array, fileName: string, env: DomEnv): Promise<Project>   // detects epub/mobi/azw3/fb2, normalizes, segments
estimateCost(project, settings): { inputTokens; outputTokens; usd?: number }
detectLanguage(project): string
generateGuide(project, provider, settings, signal): Promise<{ guideline: string; glossary: GlossaryEntry[] }>
translateProject(project, provider, settings, { onProgress, onSegment, signal }): Promise<void> // skips segments not 'pending'/'error'; batches; validates; retries; optional review pass
retranslateSegment(project, segmentId, provider, settings, signal): Promise<Segment>
exportEpub(project, mode: ExportMode, env: DomEnv): Promise<Uint8Array>
saveProjectFile(project): Promise<Uint8Array>; loadProjectFile(bytes): Promise<Project>
interface ChatProvider { listModels(signal?): Promise<string[]>; chat(req: { system: string; user: string; maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<{ text: string; usage?: { input: number; output: number } }>; }
createProvider(preset: ProviderPreset, apiKey: string, baseURL?: string, model?: string, fetchImpl?: typeof fetch): ChatProvider
PROVIDER_PRESETS: ProviderPreset[]  // id, label, baseURL, kind: 'openai-compatible' | 'anthropic', docsUrl
```
Translation protocol: system prompt = stable prefix (role, language pair, guideline, glossary) + rules; user message = JSON `{"segments":[{"id":"…","html":"…"}]}`; model must answer JSON `{"segments":[{"id":"…","html":"…"}]}`. Validate: same id set, inline tag multiset preserved (b, i, em, strong, a, span, sup, sub, br, small, u, code); on mismatch split batch and retry; persist per segment via `onSegment`. Retry/backoff: 429/5xx/network with exponential backoff + jitter, honor `Retry-After`, max 5 attempts.

## Phases
| # | Phase | Owner | Depends on | Files owned |
|---|-------|-------|-----------|-------------|
| 1 | Monorepo scaffold + core + fixtures + remove Go | agent A | — | root config, `packages/core/**`, fixtures, deletion of Go/legacy files |
| 2a | Web app | agent B | 1 | `apps/web/**` |
| 2b | CLI + CI/Pages/Release workflows + install script + README/docs | agent C | 1 | `apps/cli/**`, `.github/**`, `scripts/**`, `README.md`, `docs/**`, `LICENSE` |
| 3 | Integration: e2e (incl. key-leak test), epubcheck, real-model e2e | orchestrator | 2a, 2b | `apps/web/e2e/**`, fixes |
| 4 | Isolated review + fixes | fresh reviewer | 3 | — |
| 5 | PR, merge, deploy, release, verify live | orchestrator | 4 | — |

## Validation
`bun install && bun run typecheck && bun run lint && bun run test && bun run build`; Playwright e2e with mock provider; epubcheck via Docker on exported fixtures; real e2e using `~/.config/epubtrans-run/test.env` (budget cap 3 USD).

## Risks
- foliate-js parsers in Bun need DOM globals → shim with linkedom; if MOBI parsing fails in CLI, fall back to documenting web-only for that format is NOT allowed (Done means 3/9) — fix instead.
- Model returns broken JSON → tolerant parse (strip fences) + split-batch retry.
- XHTML strictness → always serialize with XMLSerializer, never innerHTML strings.
