# @epubtrans/core

Environment-agnostic engine shared by the web app and the CLI: import DRM-free EPUB, MOBI,
AZW3 (KF8) and FB2 books, translate them with any OpenAI-compatible or Anthropic model, and
export valid EPUB 3 in three layouts.

Core never touches DOM globals. Pass a `DomEnv`:

```ts
// Browser
const env = { DOMParser, XMLSerializer };

// Bun / Node (linkedom has no XMLSerializer; its nodes serialize themselves)
import { DOMParser } from 'linkedom';
const env = { DOMParser, XMLSerializer: class { serializeToString(n: Node) { return String(n); } } };
```

```ts
import { createProvider, exportEpub, getProviderPreset, importBook, translateProject } from '@epubtrans/core';

const project = await importBook(bytes, 'book.azw3', env);
project.settings = { ...project.settings, targetLang: 'vi', model: 'my-model' };
const provider = createProvider(getProviderPreset('openrouter'), apiKey, undefined, project.settings.model);
await translateProject(project, provider, project.settings, { onSegment: save, onProgress: show, signal });
const epub = await exportEpub(project, 'bilingual', env);
```

Main exports: `importBook`, `detectFormat`, `detectLanguage`, `estimateCost`, `generateGuide`,
`translateProject`, `retranslateSegment`, `exportEpub`, `saveProjectFile`, `loadProjectFile`,
`createProvider`, `PROVIDER_PRESETS`, `GUIDELINE_PRESETS`, `createDefaultSettings`, `ProviderError`.
Types live in `src/types.ts`.

`third-party/foliate-js/` vendors the foliate-js MOBI/KF8 parser (MIT, see its LICENSE and the
header of `mobi.js` for local modifications).

Tests: `bun run test` (Vitest with linkedom). Fixtures in `test/fixtures` are public domain:
Project Gutenberg eBook #1080, *A Modest Proposal* by Jonathan Swift, downloaded as EPUB 3,
MOBI and KF8 (AZW3); `aesop-fables.fb2` is hand-written from G. F. Townsend's 1867 translation.
