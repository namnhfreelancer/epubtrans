# epubtrans

[![CI](https://github.com/namnhfreelancer/epubtrans/actions/workflows/ci.yml/badge.svg)](https://github.com/namnhfreelancer/epubtrans/actions/workflows/ci.yml)

Translate DRM-free books into **bilingual EPUB** with the AI model of your choice, in the browser or from the command line.

- **Web app (no install, no server):** <https://namnhfreelancer.github.io/epubtrans/>
- **CLI (single binary):** Linux, macOS and Windows, see [Command line](#command-line)
- Input: EPUB, MOBI, AZW3, FB2, plain text and Markdown (DRM-free; Adobe ADEPT, Readium LCP and Apple FairPlay books are refused with a clear message). Output: valid EPUB 3 (checked with [epubcheck](https://www.w3.org/publishing/epubcheck/)).
- TXT and Markdown are converted to EPUB first: chapters start at headings (Markdown `#`/`##`) or at lines such as "Chapter 3", "CHAPTER IV." or a bare roman numeral (TXT), otherwise the text is cut into parts of about 40 paragraphs. Markdown keeps emphasis, links (http(s) and mailto only) and code; raw HTML is dropped. A Markdown file without any blank line gets one paragraph per line (otherwise hard-wrapped lines are joined, as in TXT), a leading `---` that is not YAML front matter is a scene break, and a very long paragraph is split at sentence ends so it fits one model answer (emphasis and links cut by a split are closed and reopened).
- Any language pair, source language auto-detected. Inline formatting (bold, italics, links, ...) survives translation.
- **Word Wise hints** for language learners: short glosses above the difficult words of the original text, with or without a translation (see [Word Wise hints](#word-wise-hints)).

Tiếng Việt: xem [phần tiếng Việt](#tiếng-việt) ở cuối trang.

## Privacy

There is no backend. The web app runs entirely in your browser:

- Your book never leaves your device. Books and translation progress are stored in your browser (IndexedDB).
- Your API key is stored only in your browser and is sent **only** to the provider endpoint you selected (an automated browser test records the network log to enforce this). It is never sent to this project, to GitHub, or to any analytics service.
- **"Remember key" caveat:** by default the key lives in memory only and disappears when you close the tab. If you tick "remember key", it is stored in this browser's `localStorage` for the `namnhfreelancer.github.io` origin, and that origin is shared with the owner's other GitHub Pages sites, whose scripts could read it. On a shared machine, or if you do not want that, leave the box unchecked.
- The CLI reads the key from an environment variable or a file, never from a command-line argument, and never prints it. It never takes the endpoint from a project file: built-in providers always use their own endpoint (unless you pass `--base-url` on that run), and the `custom` provider needs `--base-url` on every run, so a shared `.epubtrans` file cannot redirect your key.

## Providers

You bring your own API key (BYOK). Presets:

| Preset | Endpoint | Key variable (CLI) |
|--------|----------|--------------------|
| Anthropic | `https://api.anthropic.com` (native Messages API) | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY` |
| OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| DeepSeek | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| Custom | any OpenAI-compatible URL (Ollama, LM Studio, proxies, ...) | `EPUBTRANS_API_KEY` |

Models are listed from the provider's `/models` endpoint; you can always type a model id by hand. Cost is estimated before translating from token counts and the prices you enter (USD per 1M tokens; OpenRouter prices are filled in automatically). No price table is bundled.

Tokens read from the provider's prompt cache are counted separately in the usage shown during and after a run, and priced at a discount: the book's "cached input price" (web) or `--cached-ratio` (CLI), else the provider's documented ratio (Anthropic 0.1 for cache reads and 1.25 for cache writes, OpenAI 0.5, Gemini 0.25, DeepSeek 0.26; OpenRouter and custom endpoints price cached tokens like other input).

**Reasoning models.** Settings (web, per provider) and `--reasoning` (CLI) choose `default`, `low` or `off`: `reasoning_effort` for OpenAI-compatible endpoints, OpenRouter's `reasoning` object, Anthropic's `thinking` (off, or the smallest budget for low). When an endpoint rejects the field (HTTP 400/422), `off` tries `minimal` effort next (for models that cannot switch reasoning off), then the request goes without the field; what worked is remembered for that endpoint and model for the rest of the session, and a rejection never counts toward the stop after five consecutive client errors.

Prices are looked up automatically for the selected model from public catalogs: OpenRouter's `GET https://openrouter.ai/api/v1/models`, then LiteLLM's `model_prices_and_context_window.json` on `raw.githubusercontent.com`. Both are plain unauthenticated GETs of public files: your API key, book and model name are never sent to them (the match happens on your device). The web app shows where the price came from ("Price from OpenRouter (matched: anthropic/claude-opus-5.5)"), caches the parsed prices in `localStorage` for 24 hours, and falls back to manual entry when the model is unknown or the catalogs are unreachable; prices you type always win. The CLI prints the source and matched id before the estimate, gives up after 5 seconds when a catalog does not answer, and skips the lookup with `--no-price-lookup`.

## Web app

1. Open the app and add your provider, API key and model (the key stays in the browser; see the "remember key" caveat under [Privacy](#privacy)).
2. Drop in a book. The source language is detected automatically; pick the target language.
3. Optionally let the model draft a **style guideline and glossary** for the book, then edit them; start from a preset (general, fiction, technical, psychology) if you prefer. Turn on **Polish for natural style** for literature (see [Translation quality](#translation-quality)).
4. Check the token and cost estimate, then translate. Progress is saved continuously: reload or close the tab and it resumes without redoing finished segments.
5. Read side by side, edit any segment, or re-translate a single segment. Failed segments and **warnings** (a translation identical to its source, likely left untranslated; short, numeric and name-only text is ignored) have their own counts, previous/next buttons and filters. Warnings are still exported as they are.
6. **Preview** the finished EPUB in the browser before downloading it: Kindle, phone, tablet or desktop size, light/sepia/dark theme, pages or scrolling, font size, table of contents and search. Click a paragraph to open it in the editor; failed segments are highlighted. These settings only affect the preview, never the file.
7. Export the EPUB as **bilingual** (original, then translation, original faded), **bilingual-translation-first**, **translation-only**, or **original + hints** (the original text with [Word Wise hints](#word-wise-hints), no translation needed). The preview shows the hints too in every mode that can carry them. Give the book its own look with a [book style](#book-style-fonts-and-templates).

The library keeps several books. Each book can be exported to, and imported from, a `.epubtrans` project file. The glossary can be exported as CSV or JSON and imported from CSV, TSV or JSON (merge keeps your existing entries, or replace), for example to reuse names across a series. Changing the target language of a book that already has translations asks whether to keep them or reset them to pending, so a book never silently mixes two languages; other tabs open on the same book follow the new language, and a translation into the old one that is still in flight is discarded. The interface is available in English and Vietnamese and the app is an installable PWA.

### Translation quality

Every request asks the model to translate meaning, voice and intent rather than words: write each segment as natural prose in the target language first (sentences and clauses may be merged, split or reordered within a segment), never add or drop meaning, and only then put the inline tags back around the matching words. These rules are fixed in the system prompt, so they apply whatever guideline you use; your guideline follows them. For Vietnamese targets the prompt also lists the usual translationese traps (overused "bị/được" passives, "một cách + adjective", chains of "của", "sự/việc" nominalizations, repeated pronouns and "nó" for people, inconsistent *xưng hô*, idioms translated word by word); other targets get a short generic section. Glossary entries are used for their terms but may be inflected and moved so the sentence stays natural, and are not forced where a word has an ordinary, different sense.

Each request also carries read-only context: the book title and author (in the system prompt, which stays identical for a whole run so providers can cache it) and, in the user message, the chapter title and up to 3 paragraphs before the batch (at most 600 characters each), with their translations when they exist. Single-segment retranslation and samples get the same context. The model never translates or returns the context, and answers are only read for the requested segment ids. This adds roughly 20–30% input tokens, which the estimate includes.

**Polish for natural style** (setting `twoPass`; web toggle under Options, CLI `--polish` or `--two-pass`, WebMCP `twoPass`) adds a second pass in which a native editor rewrites every draft for natural style, with the neighbouring drafts as read-only context, using the source only to check that nothing was added, dropped or mistranslated. It is off by default, costs about twice as much, and is recommended for fiction and other literature; the guideline card suggests it when the fiction preset is picked. Polished segments show as "Polished".

### Glossary and style guideline

"Generate guideline & glossary" (web) and `--generate-guide` (CLI) work in three steps:

1. **Scan (local, no model call).** The whole book is scanned for glossary candidates: multi-word names ("Ministry of Magic", "Mr. Darcy"), capitalized words that recur mid-sentence, and frequent phrases such as "natural selection" (Chinese, Japanese and Korean: frequent character sequences). Each candidate keeps its frequency and up to two short context snippets.
2. **Guideline.** One request with about 18 passages spread across the book returns a guideline with fixed sections: genre & audience, tone & register, forms of address & pronouns (for Vietnamese the *xưng hô* pair per relationship), names policy, dialogue & quotation marks, honorifics & titles, units/numbers/dates, chapter titles & headings, footnotes, and terms to keep untranslated. Your current guideline (a preset or your own text) is kept as is; the generated part is added below it under `## Book-specific guideline`, between `<!-- epubtrans:generated:start -->` and `<!-- epubtrans:generated:end -->` lines, and generating again replaces only that part (keep the marker lines; text you add outside them is kept).
3. **Glossary.** The model classifies the candidates in batches of 80 (person, place, organization, term, other), translates the real terms and drops the rest. Entries you already have are kept and win over duplicates. The glossary grows with the book: about one entry per 500 words, at least 30, at most 400 by default (web: "Max glossary entries").

Each translation request only carries the glossary entries whose term occurs in that batch (whole-word, case-insensitive; the review pass also checks the draft), so a large glossary does not inflate every request. Words of 4 or more Latin, Cyrillic or Greek letters also match with a short ending of up to 3 letters, and a final vowel may change, so "Horcrux" matches "Horcruxes", "Darcy" matches "Darcys" and "Анна" matches "Анну"; shorter words and words with digits must match exactly ("art" never matches "artist", "Name1" never matches "Name10"). Generation costs one request plus one per 80 candidates: for a 1000-page book about 11 requests, roughly 100k input and 20k output tokens (about $0.60 at $3/$15 per 1M tokens); a short book needs 2 requests. The web glossary table has search, a type filter and pages of 50 rows.

### Word Wise hints

Kindle Word Wise shows short hints above difficult words. epubtrans writes similar hints into the exported EPUB itself, for any reader app, on the **original** text:

- **Who it is for:** learners reading the original (export "Original + hints": no translation needed at all) and bilingual readers (the hints go on the source passages of both bilingual layouts; "Translation only" has no original text and therefore no hints).
- **Turn it on per book** ("Word Wise hints" on the Translate tab), pick the **difficulty** (1 = fewest hints, only the rarest words, for about C2 readers; 5 = most hints, for about A2; default 3, about B2) and the **gloss language** (default: the book's target language; choose the source language for simple same-language definitions).
- **Generate hints** is a separate button (CLI: `epubtrans hints`), never part of a translation run. It shows a token and cost estimate first (same automatic pricing as translation), runs as a job under the same one-job-per-book lock, and saves every finished word, so a reload or a cancel resumes where it stopped and a higher level later only adds the new words. A word is glossed together with all its forms ("frustrate" and "frustrating"), and each form keeps its own frequency, so changing the level later shows exactly the forms that level would pick without new requests for words already glossed.
- **How words are picked (locally):** each word's frequency rank in a list derived from [wordfreq](https://github.com/rspeer/wordfreq) decides whether it is difficult at the chosen level. Skipped: proper nouns (capitalized mid-sentence or right after an opening bracket, quote or colon in running prose, capitalized words the book never writes in lowercase, and glossary names; a word among the 20,000 most common that the book capitalizes only at sentence starts or at the start of a quotation, such as "Similarly", is still an ordinary word), numbers, very short words, fragments split off by markup (drop caps such as `<span>A</span>lthough`), back matter (index, notes, bibliography and similar chapters), and text in code, math, sub/superscripts, note references, links, form controls and their labels, and ruby. English inflections are grouped with a small rule-based lemmatizer ("obfuscated" → "obfuscate", "graves" → "grave", "moored" → "moor"; list entries that are only names, such as "moore", are never base forms, and a reading the book writes in lowercase beats one it never uses).
- **How glosses are written:** your model receives each difficult word with its sentence (at most two contexts per word, batched 40 per request) and answers a gloss of at most about 4 words plus a short sense label. A word whose contexts share one sense gets one gloss everywhere; a word with several senses ("bank" of a river, "bank" for money) gets its other occurrences checked against the known senses, so each gloss is cached per word and sense across the book. Answers are validated (JSON, known ids, plain text, length caps) with retries and backoff, and glosses are only ever written as text.
- **Display:** by default `<ruby>word<rp> (</rp><rt>gloss</rt><rp>)</rp></ruby>` with a small gloss above the word and extra line height; readers without ruby support show "word (gloss)". The **Kindle / EPUB 2** style writes "word (gloss)" inline; EPUB 2 books always use it because ruby is invalid there. Exports pass epubcheck with zero errors.
- **Density (at export, no new requests):** at most N hints per paragraph (default 3, rarest first) and only the first N occurrences of a word sense per chapter (default 1). Lowering the level at export also needs no new requests.
- **Cost:** for a 1000-page book roughly 0.4M input and 0.15M output tokens at level 3, about $0.05–0.50 with cheap models or $3–4 with Sonnet-class models; the app and CLI show the exact estimate for your book first.

Supported source languages: English, French, German, Spanish, Italian, Portuguese, Russian, Dutch, Polish, Swedish, Ukrainian, Czech, Japanese, Chinese (Simplified) and Korean. Limitations: only English groups inflected forms (other languages match exact word forms after lowercasing, so a rare inflection of a common word may get a hint); Chinese and Japanese use the browser's or Bun's word segmentation, which differs from wordfreq's, so selection is weaker there; their lists hold about 30,000 words, so a Han word of 2+ characters missing from the list counts as rare (hinted at every level, also 1–2) unless it splits into listed words, as the segmenter's word + particle tokens do (笑了 = 笑 + 了, 我的 = 我 + 的): such a compound is as rare as its rarest part; unlisted single characters and kana-only words are never hinted; Korean words carry their particles ("사람들은"), so only forms found in the list as they are can get a hint and Korean books get few hints; Traditional Chinese and languages without a list (for example Vietnamese) are not supported (a book tagged plain `zh` whose text is in Traditional characters is detected from its characters, and then only words that are also in the Simplified list can get a hint); the frequency data is frozen at about 2021; multi-word expressions and phrasal verbs are not detected; ruby rendering on real Kindle devices with Latin text is unverified (use the Kindle / EPUB 2 style if it does not show). Real Kindle Word Wise cannot be produced from an EPUB.

### Book style, fonts and templates

Each book has an optional **book style** (Export tab, and next to the Preview, where changes show live after a short pause): a preset (Classic faded original, Learner with prominent hints, High contrast, Translation emphasis, Minimal) or your own values for the original text (color, opacity, size, italic, font), the translation (color, font, weight, size), the space between blocks and the Word Wise hints (color, size; ruby or inline stays under "Hint style"). The style only goes into the book's generated `epubtrans.css`, never into inline styles. No background color is ever set, so the reader's light, sepia and dark themes keep working, and every color is optional (default: the reader's). Values are checked strictly (colors `#rgb`, `#rrggbb` or `rgb(r, g, b)`, numbers within their ranges, fonts from a fixed list), and the CSS stays valid for EPUB 2 readers. The original-text settings apply to the bilingual layouts; "Original + hints" uses only the hint settings.

**Embedded fonts.** A block can use the reader's serif, sans-serif or monospace font, or one of four bundled fonts with full Vietnamese coverage: Literata, Noto Serif, Be Vietnam Pro and Noto Sans (TrueType subsets of the official Google Fonts files, SIL Open Font License 1.1, see [packages/core/data/fonts/](packages/core/data/fonts/README.md)). A chosen font is embedded in the EPUB (regular, italic and bold, about 200–480 KB per family before compression; the app shows the added size first) together with its license file, never obfuscated. The web app loads the font files from its own origin only when a style uses them; the CLI carries them inside its binary.

**Style templates.** Save a book's style as a named template, apply it to another book, rename or delete it, and export or import templates as a JSON file (validated, at most 64 KB and 100 templates; settings a newer version added are skipped with a notice naming them). The CLI reads the same file with `--style-file`.

**Book identifier.** Every export gets its own `dc:identifier` (a `urn:uuid` derived from the source book's identifier, the target language and the layout, so the same export always gets the same id and reading apps keep translations apart from the original). The source identifier stays as a second `dc:identifier` and as `dc:source`. A book whose fonts are obfuscated (listed in `META-INF/encryption.xml`) keeps its original identifier, because the obfuscation key is derived from it.

**Attribution (opt-in).** Tick "Add a 'Translated with <model> by epubtrans' page" to end the book with a short colophon page in the target language (English when the language has no phrase yet). It is off by default; it is a new page after the last chapter, so no page of the book changes (in fixed-layout books the page is reflowable). Exporting a book that is itself an epubtrans export replaces its earlier attribution page and identifier instead of adding another. CLI: `--attribution`, `--no-attribution`.

### Use with AI agents (WebMCP)

The web app offers its main actions as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools, so an AI agent running in your browser can call them instead of clicking through the page. WebMCP is an experimental browser API (a W3C community-group draft). Today it exists only in Chrome and Edge 149 or later, with the origin trial or the `chrome://flags/#enable-webmcp-testing` flag. The app does not register for the origin trial, so you need the flag. In every other browser nothing changes: the app checks for `document.modelContext` and does nothing when it is missing (no polyfill is loaded).

| Tool | What it does |
|------|--------------|
| `list_books`, `get_book_status` | Read the library, and one book's settings, progress, job status, Word Wise hints state and cost estimate |
| `import_book_from_url` | Download a book from an `https://` URL (after you approve the host) |
| `update_book_settings` | Target/source language, polish pass (`twoPass`), guideline preset, book style preset (replacing a custom style asks you first); a target change on a translated book needs `resetTranslations: true` and the user's approval |
| `configure_provider`, `list_models` | Pick a provider preset, model and reasoning setting; presets you have not set up report that they are not ready |
| `generate_guide`, `translate_sample` | Draft the guideline and glossary, translate a sample (small paid runs) |
| `start_translation`, `pause_translation` | Start or resume the full paid translation (after you approve it), pause it |
| `list_errors`, `retranslate_segment` | Find failed segments and translate one again (never a segment you edited by hand) |
| `export_epub` | Build and download the EPUB in any export mode, including "Original + hints"; optional hint style and density, and one of your saved style templates, for this export only (agents cannot generate hints) |
| `delete_book` | Delete a book (after you approve it) |

What an agent cannot do:

- **API keys:** agents never receive, set or change a key. Tools only report whether a key is stored, and every tool output is scrubbed of stored keys before it is returned.
- **Custom endpoint:** agents cannot change the custom base URL, so a stored key cannot be redirected to another host. An agent can select any provider preset, but one without a stored key (or, for Custom, without the base URL you entered) only reports that it is not ready.
- **Spending and deleting:** `start_translation` shows a confirmation in the page with the provider, model, remaining segments, cost estimate and where its prices come from (your book's settings or looked up for the model), and `delete_book` asks before deleting. If you decline, or the browser suppresses dialogs, nothing is spent or deleted. If the provider, model, API key, polish pass or remaining work changes before the run starts, nothing starts and the agent must ask again. `generate_guide`, `translate_sample` and `retranslate_segment` cost a few requests and run without a dialog. Like the buttons, they refuse while the book is being translated, or its Word Wise hints are being generated, in this tab or another one. `retranslate_segment` refuses segments you edited by hand. Deleting a book also stops its guideline generation, sample and hints generation.
- **Downloads:** `import_book_from_url` accepts only `https://` URLs and asks you to approve the host before fetching; a redirect to another host is refused. No cookies or referrer are sent, and the usual 300 MB limit applies. Many sites (for example Project Gutenberg) do not allow downloads from other web pages (CORS); the agent is then told to ask you to drop the file instead.
- **Other sites:** tools are only visible on the app's own origin (no cross-origin exposure).

Tool outputs that contain book text, model output or provider error messages are flagged as untrusted content (`untrustedContentHint`), so agents treat them as data rather than instructions. Each output stays under 1,500 characters. A dialog accepted by an agent that drives the browser itself (for example over the DevTools protocol) cannot be told apart from your own click. Agents that respect the `consequentialHint` flag on `start_translation` and `delete_book` should ask you first.

## Command line

### Install

Linux and macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/namnhfreelancer/epubtrans/main/scripts/install_unix.sh | bash
```

Options: `bash -s -- --system` (install to `/usr/local/bin`), `--dir DIR`, `--version v3.0.0`. Installs to `~/.local/bin` by default.

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/namnhfreelancer/epubtrans/main/scripts/install_windows.ps1 | iex
```

Both installers download the binary from the latest [GitHub release](https://github.com/namnhfreelancer/epubtrans/releases/latest) and verify it against the release's `SHA256SUMS`. You can also download `epubtrans-<os>-<arch>` (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64.exe`) manually. Check with `epubtrans --version`.

### Use

```bash
export EPUBTRANS_API_KEY=...          # or OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, ...

epubtrans models --provider openrouter
epubtrans translate book.epub --to vi --provider openrouter --model <model-id>
```

`translate` imports the book, prints a token and cost estimate, asks for confirmation (skip with `--yes`), translates with a progress display and writes `book.vi.epub`. The key can also come from `--api-key-file <path>` (`-` reads stdin). **The key is never accepted as a plain argument**, because it would leak into shell history and process lists.

`EPUBTRANS_API_KEY` goes to the provider you name on that run (`--provider`, or `--base-url` for a custom endpoint) or to the default on a new import. When the provider comes only from an existing project file, which may be shared, and it is not the default (`openai`), the CLI does not use `EPUBTRANS_API_KEY`: set the provider's own variable (for example `DEEPSEEK_API_KEY`), pass `--api-key-file`, or pass `--provider <id>` yourself. Projects on the default provider keep working with `EPUBTRANS_API_KEY`, so re-running the same command or `epubtrans resume` needs no extra flag.

Progress is saved continuously to `book.epub.epubtrans`. After Ctrl-C or a crash, run the same command again and finished segments are not translated twice.

| Command | Purpose |
|---------|---------|
| `epubtrans translate <input> --to <lang> [options]` | Import, estimate, translate, export |
| `epubtrans resume <file.epubtrans> [options]` | Continue a project from the web app or an earlier run, then export |
| `epubtrans export <file.epubtrans> --mode <mode> --out <file>` | Write the EPUB from a project (no key needed) |
| `epubtrans models [--provider <id>] [--base-url <url>]` | List models from `/models` |
| `epubtrans presets` | List providers, guideline presets and export modes |
| `epubtrans sample <input or file.epubtrans> [--passages N] [--words N] [--seed S] [--new]` | Translate a few passages from different chapters and print them as source/translation pairs, before the full run |
| `epubtrans hints <input or file.epubtrans> [--level N] [--gloss-lang xx] [--style ruby\|inline]` | Generate [Word Wise hints](#word-wise-hints) and save them in the project file (no translation needed) |
| `epubtrans glossary export <file.epubtrans> --out <file.csv\|.tsv\|.json>` | Write the project's glossary for reuse (`--glossary-file`, web import) |

**Sample translation.** To check quality before paying for a whole book, translate a sample first: in the web app use the "Sample translation" card on the setup page, on the command line run `epubtrans sample book.epub --to vi --model <id>`. It picks 5 passages of about 350 words from different chapters spread across the book (seeded, so the same seed picks the same passages), translates them with your guideline and glossary, and shows source and translation side by side. Change the guideline or glossary and run it again to compare ("Translate samples again" in the app, the same command in the CLI); "New random samples" or `--new` picks other passages. The sampled segments count as translated, so the full run skips them. The selection is stored in the project file. A sample never loses work: segments you edited by hand are skipped, and when a sample request fails, a segment that already had a translation keeps it. Both are reported: the app shows a warning instead of the success message when some segments failed (an error when all of them did), says how many hand-edited segments were kept, and labels those segments in the sample view; the CLI labels them in its report and exits with an "incomplete" status. Back matter (index, notes, bibliography, acknowledgments) is not sampled.

Common options: `--from <lang>` (default auto), `--provider <preset id>`, `--base-url <url>`, `--model <id>`, `--concurrency <1-16>`, `--polish` (alias `--two-pass`), `--guideline-preset general|fiction|technical|psychology`, `--guideline-file <path>`, `--generate-guide`, `--mode bilingual|bilingual-translation-first|translation-only`, `--out <file.epub>`, `--project <file>`, `--price-in/--price-out <USD per 1M tokens>`, `--cached-ratio <0-2>`, `--max-segments <1-200>` (segments per request, default 32), `--reasoning default|low|off`, `--identical-min-letters <n>` (0 turns the identical-translation warning off), `--glossary-file <csv|tsv|json>` (translate, sample and hints; merged, project entries win; hints never gloss names from it), `--yes`. Run `epubtrans <command> --help` for details.

`--no-price-lookup` turns off the automatic price lookup used when `--price-in/--price-out` are absent.

**Word Wise hints.** `epubtrans hints book.epub --gloss-lang vi --model <id>` imports the book (if needed), prints an estimate, asks for confirmation and saves the glosses in `book.epub.epubtrans`; run it again to resume, or with a higher `--level` to add words. Options: `--level 1-5`, `--gloss-lang <lang>` (also the target language of a new project without `--to`), `--style ruby|inline`, `--hints-per-paragraph N`, `--hints-per-chapter N`, plus the provider and price options. Then `epubtrans export book.epub.epubtrans --mode original --word-wise` writes the original with hints. `translate`, `resume` and `export` accept `--word-wise`, `--hint-style ruby|inline`, `--hint-level N`, `--hints-per-paragraph N` and `--hints-per-chapter N`; they only apply hints that were already generated (`export` does not change the project file).

**Book style.** `--style-file style.json` (on `translate`, `resume`, `export` and `hints`) reads a [book style](#book-style-fonts-and-templates) from a JSON file: a style object such as `{"source": {"opacity": 0.5, "italic": true}, "translation": {"font": "literata", "color": "#333333"}}`, or a template file exported from the web app holding one template. It is validated like in the web app and produces the same CSS and embedded fonts. `--attribution` adds the opt-in attribution page and `--no-attribution` leaves it out. `translate`, `resume` and `hints` save the style and the attribution choice in the project file; `export` applies them to that export only. Style keys a newer version added (in a style file or a project file) are skipped with a warning; invalid values are still rejected.

Exit codes: `0` success, `1` error, `2` usage error, `3` finished with untranslated segments (EPUB still written), `130` interrupted (progress saved).

## Project files

A `.epubtrans` file is a zip containing `project.json` (schema-versioned settings, glossary and per-segment state) and `source.epub` (the normalized book). It holds no API key. The web app and the CLI read and write the same format, so you can start in the browser and finish on a server (or the reverse). Details: [docs/system-architecture.md](docs/system-architecture.md).

## Development

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun run typecheck && bun run lint && bun run test && bun run build
bun run format                         # Biome formatter
bun apps/cli/src/main.ts --help        # run the CLI from source
bun scripts/build-cli.ts --host        # compile a binary into dist/
bun scripts/smoke-cli-binary.ts        # smoke-test that binary
```

Layout: `packages/core` (engine), `apps/web` (Vite + React app), `apps/cli` (Bun CLI). More in [docs/](docs/) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and license

epubtrans was created by [nguyenvanduocit](https://github.com/nguyenvanduocit/epubtrans); v2 and its prompt presets are his work. This v3 rewrite (TypeScript monorepo, browser app, new CLI) builds on that project and keeps its attribution. Two parts are vendored from [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, Copyright (c) 2022 John Factotum): the MOBI/KF8 parser in `packages/core/third-party/foliate-js/` and the EPUB reader behind the web app's Preview tab in `apps/web/src/preview/third-party/foliate-js/`. Each copy keeps its license text, and the web build keeps the license notice in its bundles.

Word Wise hints use word frequency lists derived from [wordfreq](https://github.com/rspeer/wordfreq) by Robyn Speer et al., whose data is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The derived lists in `packages/core/data/wordfreq/` are distributed under the same license; see the README there. The share-alike terms apply to those data files only.

The embeddable fonts in `packages/core/data/fonts/` (Literata, Noto Serif, Be Vietnam Pro, Noto Sans) are subsets of the official Google Fonts files, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/) by their authors; each family's license file sits next to it and is copied into every EPUB that embeds the family.

See [LICENSE](LICENSE) for the terms that apply to this repository. Exceptions: the files under `packages/core/data/wordfreq/` (also embedded in the CLI binaries) are derived from wordfreq and licensed CC BY-SA 4.0, and the fonts under `packages/core/data/fonts/` (also embedded in the CLI binaries) are licensed under the SIL OFL 1.1; neither falls under the project license.

---

## Tiếng Việt

epubtrans dịch sách **không DRM** (EPUB, MOBI, AZW3, FB2, TXT, Markdown) thành **EPUB song ngữ** bằng mô hình AI mà bạn chọn, ngay trong trình duyệt hoặc bằng dòng lệnh.

- **Dùng thử không cần cài đặt:** <https://namnhfreelancer.github.io/epubtrans/>
- **Riêng tư:** không có máy chủ. Sách và tiến độ dịch lưu trong trình duyệt của bạn. API key chỉ nằm trong trình duyệt và chỉ được gửi tới nhà cung cấp bạn đã chọn (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek hoặc URL tương thích OpenAI). Lưu ý: nếu bật "nhớ khóa", khóa được lưu trong `localStorage` của trình duyệt cho origin `namnhfreelancer.github.io`, origin này dùng chung với các trang GitHub Pages khác của chủ repo; trên máy dùng chung hoặc nếu bạn không muốn vậy, hãy để ô này không chọn.
- **Tự mang API key (BYOK):** ứng dụng ước tính token và chi phí trước khi dịch, tự tạo hướng dẫn văn phong và bảng thuật ngữ (chỉnh sửa được), dịch theo nghĩa thay vì từng chữ, có thêm lượt “Trau chuốt văn phong cho tự nhiên” (tùy chọn), lưu tiến độ liên tục nên tải lại trang vẫn dịch tiếp.
- **Dịch tự nhiên, theo nghĩa:** mô hình được yêu cầu viết mỗi đoạn thành văn tự nhiên của ngôn ngữ đích trước (được gộp, tách, đảo câu trong đoạn), không thêm bớt ý, rồi mới đặt lại thẻ định dạng. Với tiếng Việt, prompt nêu rõ các lỗi “văn dịch” thường gặp: lạm dụng “bị/được”, “một cách + tính từ”, chuỗi “của”, danh hoá bằng “sự/việc”, lặp đại từ, dùng “nó” cho người, xưng hô không nhất quán. Mỗi yêu cầu kèm tên sách, tên chương và 2–3 đoạn đứng trước (chỉ để tham khảo, không dịch lại). Bảng thuật ngữ được dùng linh hoạt theo ngữ pháp. Tùy chọn **Trau chuốt văn phong cho tự nhiên** (CLI `--polish`, tên cũ `--two-pass`) thêm một lượt biên tập viên bản ngữ viết lại từng bản nháp, chi phí khoảng gấp đôi, nên bật cho sách văn học; mặc định tắt.
- **Xem trước** EPUB ngay trong trình duyệt (cỡ Kindle, điện thoại, máy tính bảng hoặc máy tính; nền sáng, giấy cũ hoặc tối; lật trang hoặc cuộn; cỡ chữ; mục lục và tìm kiếm). Bấm vào một đoạn để mở nó trong trình sửa; đoạn lỗi được tô nổi. Các tuỳ chọn này chỉ dùng cho bản xem trước, không đưa vào tệp xuất.
- **Bảng thuật ngữ dạng tệp:** xuất CSV/JSON, nhập CSV/TSV/JSON (gộp hoặc thay thế) để dùng lại cho cả bộ sách; CLI có `--glossary-file` và `epubtrans glossary export`. Đổi ngôn ngữ đích khi sách đã có bản dịch sẽ hỏi giữ nguyên hay đặt lại về chờ dịch. Bản dịch giống hệt bản gốc được đánh dấu cảnh báo (đếm và lọc riêng với lỗi). Token từ cache prompt được tính riêng và theo giá ưu đãi; có tùy chọn suy luận (mặc định/thấp/tắt) cho mô hình suy luận. Nếu nhà cung cấp không nhận mức "tắt", ứng dụng thử mức `minimal` rồi mới gửi không kèm tùy chọn này. Nhiều thẻ mở cùng một sách luôn dùng chung cài đặt đã lưu: đổi ngôn ngữ đích ở một thẻ thì các thẻ khác cập nhật theo, và bản dịch vào ngôn ngữ cũ đang chạy dở sẽ bị bỏ.
- **Nhập TXT/Markdown:** tệp Markdown không có dòng trống được tách mỗi dòng một đoạn; dòng `---` ở đầu tệp chỉ được coi là front matter khi phần bên trong đúng là YAML, nếu không thì là dấu ngắt cảnh; đoạn văn quá dài được cắt ở cuối câu để vừa một lượt trả lời của mô hình.
- **Xuất EPUB** ở 4 chế độ: song ngữ, song ngữ (bản dịch trước), chỉ bản dịch, bản gốc + gợi ý.
- **Kiểu trình bày sách:** chọn mẫu có sẵn (Cổ điển, Người học, Tương phản cao, Nhấn mạnh bản dịch, Tối giản) hoặc tự chỉnh màu, độ đậm, cỡ chữ, in nghiêng, phông chữ của bản gốc và bản dịch, khoảng cách giữa các khối và màu, cỡ chữ của gợi ý Word Wise; thay đổi hiện ngay trong thẻ Xem trước. Kiểu chỉ được ghi vào tệp `epubtrans.css` của sách, không đặt màu nền nên giao diện sáng/giấy cũ/tối của trình đọc vẫn dùng được. Có thể nhúng phông Literata, Noto Serif, Be Vietnam Pro hoặc Noto Sans (đủ dấu tiếng Việt, giấy phép SIL OFL 1.1, kèm tệp giấy phép trong sách; ứng dụng báo trước dung lượng tăng thêm). Lưu kiểu thành mẫu để áp dụng cho sách khác, đổi tên, xoá, xuất/nhập tệp JSON (CLI: `--style-file`). Sách xuất ra có mã định danh riêng (trừ sách có phông bị làm rối). Tuỳ chọn thêm trang "Dịch bằng <mô hình> với epubtrans" ở cuối sách (mặc định tắt; CLI: `--attribution`, tắt lại bằng `--no-attribution`).
- **Gợi ý Word Wise** cho người học ngoại ngữ: chú giải ngắn (tối đa khoảng 4 từ) phía trên các từ khó của bản gốc, không cần dịch sách. Bật theo từng cuốn, chọn độ khó (1–5, ước lượng theo trình độ CEFR) và ngôn ngữ chú giải (mặc định là ngôn ngữ đích), bấm "Tạo gợi ý" (CLI: `epubtrans hints`) sau khi xem ước tính chi phí; tiến độ được lưu từng từ nên tải lại trang vẫn tiếp tục. Mặc định dùng ruby phía trên từ; kiểu "Kindle / EPUB 2" ghi "từ (chú giải)" ngay trong dòng (sách EPUB 2 luôn dùng kiểu này). Dữ liệu tần suất từ lấy từ wordfreq (giấy phép CC BY-SA 4.0). Giao diện có tiếng Việt và tiếng Anh, cài được như ứng dụng (PWA).
- **Dòng lệnh:** cài bằng lệnh ở mục [Command line](#command-line), đặt khóa trong biến môi trường `EPUBTRANS_API_KEY`, rồi chạy `epubtrans translate sach.epub --to vi --model <id>` (nhà cung cấp mặc định là `openai`; dùng nhà cung cấp khác thì thêm `--provider <id>` ở mỗi lần chạy). Gặp sự cố hoặc nhấn Ctrl-C, chạy lại cùng lệnh để dịch tiếp; có thể mở tệp `.epubtrans` xuất từ web bằng `epubtrans resume`.
- **Bảng thuật ngữ và hướng dẫn văn phong:** ứng dụng quét toàn bộ sách (không tốn lượt gọi mô hình) để tìm tên riêng và thuật ngữ lặp lại, rồi nhờ mô hình phân loại (nhân vật, địa danh, tổ chức, thuật ngữ, khác) và dịch chúng; số mục tăng theo độ dài sách (khoảng 1 mục cho mỗi 500 từ, tối đa 400 theo mặc định). Hướng dẫn văn phong được viết từ khoảng 18 đoạn trích khắp cuốn sách, theo các mục cố định, trong đó có cách xưng hô giữa các nhân vật; hướng dẫn bạn đang dùng được giữ nguyên, phần tạo ra được thêm bên dưới. Mỗi yêu cầu dịch chỉ gửi kèm những thuật ngữ xuất hiện trong đoạn đó.
- **Dùng với tác tử AI (WebMCP, thử nghiệm):** trên Chrome/Edge 149 trở lên có bật cờ `chrome://flags/#enable-webmcp-testing`, tác tử AI chạy trong trình duyệt có thể gọi các thao tác chính của ứng dụng: nhập sách từ URL https, chọn mô hình, dịch mẫu, dịch, sửa đoạn lỗi, xuất EPUB. Tác tử không bao giờ đọc hay đặt API key, và không đổi được URL tùy chỉnh. Muốn dịch cả cuốn (tốn phí), xóa sách hay tải sách từ một máy chủ, bạn phải tự xác nhận trong trang. Ở các trình duyệt khác, ứng dụng không thay đổi gì. Chi tiết: [Use with AI agents (WebMCP)](#use-with-ai-agents-webmcp).

Cảm ơn tác giả gốc [nguyenvanduocit](https://github.com/nguyenvanduocit/epubtrans). Điều khoản sử dụng xem tệp [LICENSE](LICENSE).
