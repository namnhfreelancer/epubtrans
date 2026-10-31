# epubtrans

[![CI](https://github.com/namnhfreelancer/epubtrans/actions/workflows/ci.yml/badge.svg)](https://github.com/namnhfreelancer/epubtrans/actions/workflows/ci.yml)

Translate DRM-free books into **bilingual EPUB** with the AI model of your choice, in the browser or from the command line.

- **Web app (no install, no server):** <https://namnhfreelancer.github.io/epubtrans/>
- **CLI (single binary):** Linux, macOS and Windows, see [Command line](#command-line)
- Input: EPUB, MOBI, AZW3, FB2, plain text and Markdown (DRM-free; Adobe ADEPT, Readium LCP and Apple FairPlay books are refused with a clear message). Output: valid EPUB 3 (checked with [epubcheck](https://www.w3.org/publishing/epubcheck/)).
- TXT and Markdown are converted to EPUB first: chapters start at headings (Markdown `#`/`##`) or at lines such as "Chapter 3", "CHAPTER IV." or a bare roman numeral (TXT), otherwise the text is cut into parts of about 40 paragraphs. Markdown keeps emphasis, links (http(s) and mailto only) and code; raw HTML is dropped. A Markdown file without blank lines gets one paragraph per line, a leading `---` that is not YAML front matter is a scene break, and a very long paragraph is split at sentence ends so it fits one model answer.
- Any language pair, source language auto-detected. Inline formatting (bold, italics, links, ...) survives translation.

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
3. Optionally let the model draft a **style guideline and glossary** for the book, then edit them; start from a preset (general, fiction, technical, psychology) if you prefer. Turn on the **2-pass review** for higher quality.
4. Check the token and cost estimate, then translate. Progress is saved continuously: reload or close the tab and it resumes without redoing finished segments.
5. Read side by side, edit any segment, or re-translate a single segment. Failed segments and **warnings** (a translation identical to its source, likely left untranslated; short, numeric and name-only text is ignored) have their own counts, previous/next buttons and filters. Warnings are still exported as they are.
6. **Preview** the finished EPUB in the browser before downloading it: Kindle, phone, tablet or desktop size, light/sepia/dark theme, pages or scrolling, font size, table of contents and search. Click a paragraph to open it in the editor; failed segments are highlighted. These settings only affect the preview, never the file.
7. Export the EPUB as **bilingual** (original, then translation, original faded), **bilingual-translation-first**, or **translation-only**.

The library keeps several books. Each book can be exported to, and imported from, a `.epubtrans` project file. The glossary can be exported as CSV or JSON and imported from CSV, TSV or JSON (merge keeps your existing entries, or replace), for example to reuse names across a series. Changing the target language of a book that already has translations asks whether to keep them or reset them to pending, so a book never silently mixes two languages; other tabs open on the same book follow the new language, and a translation into the old one that is still in flight is discarded. The interface is available in English and Vietnamese and the app is an installable PWA.

### Glossary and style guideline

"Generate guideline & glossary" (web) and `--generate-guide` (CLI) work in three steps:

1. **Scan (local, no model call).** The whole book is scanned for glossary candidates: multi-word names ("Ministry of Magic", "Mr. Darcy"), capitalized words that recur mid-sentence, and frequent phrases such as "natural selection" (Chinese, Japanese and Korean: frequent character sequences). Each candidate keeps its frequency and up to two short context snippets.
2. **Guideline.** One request with about 18 passages spread across the book returns a guideline with fixed sections: genre & audience, tone & register, forms of address & pronouns (for Vietnamese the *xưng hô* pair per relationship), names policy, dialogue & quotation marks, honorifics & titles, units/numbers/dates, chapter titles & headings, footnotes, and terms to keep untranslated. Your current guideline (a preset or your own text) is kept as is; the generated part is added below it under `## Book-specific guideline`, between `<!-- epubtrans:generated:start -->` and `<!-- epubtrans:generated:end -->` lines, and generating again replaces only that part (keep the marker lines; text you add outside them is kept).
3. **Glossary.** The model classifies the candidates in batches of 80 (person, place, organization, term, other), translates the real terms and drops the rest. Entries you already have are kept and win over duplicates. The glossary grows with the book: about one entry per 500 words, at least 30, at most 400 by default (web: "Max glossary entries").

Each translation request only carries the glossary entries whose term occurs in that batch (whole-word, case-insensitive; the review pass also checks the draft), so a large glossary does not inflate every request. Words of 4 or more Latin, Cyrillic or Greek letters also match with a short ending of up to 3 letters, and a final vowel may change, so "Horcrux" matches "Horcruxes", "Darcy" matches "Darcys" and "Анна" matches "Анну"; shorter words and words with digits must match exactly ("art" never matches "artist", "Name1" never matches "Name10"). Generation costs one request plus one per 80 candidates: for a 1000-page book about 11 requests, roughly 100k input and 20k output tokens (about $0.60 at $3/$15 per 1M tokens); a short book needs 2 requests. The web glossary table has search, a type filter and pages of 50 rows.

### Use with AI agents (WebMCP)

The web app offers its main actions as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools, so an AI agent running in your browser can call them instead of clicking through the page. WebMCP is an experimental browser API (a W3C community-group draft). Today it exists only in Chrome and Edge 149 or later, with the origin trial or the `chrome://flags/#enable-webmcp-testing` flag. The app does not register for the origin trial, so you need the flag. In every other browser nothing changes: the app checks for `document.modelContext` and does nothing when it is missing (no polyfill is loaded).

| Tool | What it does |
|------|--------------|
| `list_books`, `get_book_status` | Read the library, and one book's settings, progress, job status and cost estimate |
| `import_book_from_url` | Download a book from an `https://` URL (after you approve the host) |
| `update_book_settings` | Target/source language, 2-pass review, guideline preset; a target change on a translated book needs `resetTranslations: true` and the user's approval |
| `configure_provider`, `list_models` | Pick a provider preset, model and reasoning setting; presets you have not set up report that they are not ready |
| `generate_guide`, `translate_sample` | Draft the guideline and glossary, translate a sample (small paid runs) |
| `start_translation`, `pause_translation` | Start or resume the full paid translation (after you approve it), pause it |
| `list_errors`, `retranslate_segment` | Find failed segments and translate one again (never a segment you edited by hand) |
| `export_epub` | Build and download the EPUB in any export mode |
| `delete_book` | Delete a book (after you approve it) |

What an agent cannot do:

- **API keys:** agents never receive, set or change a key. Tools only report whether a key is stored, and every tool output is scrubbed of stored keys before it is returned.
- **Custom endpoint:** agents cannot change the custom base URL, so a stored key cannot be redirected to another host. An agent can select any provider preset, but one without a stored key (or, for Custom, without the base URL you entered) only reports that it is not ready.
- **Spending and deleting:** `start_translation` shows a confirmation in the page with the provider, model, remaining segments, cost estimate and where its prices come from (your book's settings or looked up for the model), and `delete_book` asks before deleting. If you decline, or the browser suppresses dialogs, nothing is spent or deleted. If the provider, model, API key, 2-pass mode or remaining work changes before the run starts, nothing starts and the agent must ask again. `generate_guide`, `translate_sample` and `retranslate_segment` cost a few requests and run without a dialog. Like the buttons, they refuse while the book is being translated in this tab or another one. `retranslate_segment` refuses segments you edited by hand. Deleting a book also stops its guideline generation and sample.
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
| `epubtrans glossary export <file.epubtrans> --out <file.csv\|.tsv\|.json>` | Write the project's glossary for reuse (`--glossary-file`, web import) |

**Sample translation.** To check quality before paying for a whole book, translate a sample first: in the web app use the "Sample translation" card on the setup page, on the command line run `epubtrans sample book.epub --to vi --model <id>`. It picks 5 passages of about 350 words from different chapters spread across the book (seeded, so the same seed picks the same passages), translates them with your guideline and glossary, and shows source and translation side by side. Change the guideline or glossary and run it again to compare ("Translate samples again" in the app, the same command in the CLI); "New random samples" or `--new` picks other passages. The sampled segments count as translated, so the full run skips them. The selection is stored in the project file. A sample never loses work: segments you edited by hand are skipped, and when a sample request fails, a segment that already had a translation keeps it. Both are reported: the app shows a warning instead of the success message when some segments failed (an error when all of them did), says how many hand-edited segments were kept, and labels those segments in the sample view; the CLI labels them in its report and exits with an "incomplete" status. Back matter (index, notes, bibliography, acknowledgments) is not sampled.

Common options: `--from <lang>` (default auto), `--provider <preset id>`, `--base-url <url>`, `--model <id>`, `--concurrency <1-16>`, `--two-pass`, `--guideline-preset general|fiction|technical|psychology`, `--guideline-file <path>`, `--generate-guide`, `--mode bilingual|bilingual-translation-first|translation-only`, `--out <file.epub>`, `--project <file>`, `--price-in/--price-out <USD per 1M tokens>`, `--cached-ratio <0-2>`, `--max-segments <1-200>` (segments per request, default 32), `--reasoning default|low|off`, `--identical-min-letters <n>` (0 turns the identical-translation warning off), `--glossary-file <csv|tsv|json>` (translate and sample; merged, project entries win), `--yes`. Run `epubtrans <command> --help` for details.

`--no-price-lookup` turns off the automatic price lookup used when `--price-in/--price-out` are absent.

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

See [LICENSE](LICENSE) for the terms that apply to this repository.

---

## Tiếng Việt

epubtrans dịch sách **không DRM** (EPUB, MOBI, AZW3, FB2, TXT, Markdown) thành **EPUB song ngữ** bằng mô hình AI mà bạn chọn, ngay trong trình duyệt hoặc bằng dòng lệnh.

- **Dùng thử không cần cài đặt:** <https://namnhfreelancer.github.io/epubtrans/>
- **Riêng tư:** không có máy chủ. Sách và tiến độ dịch lưu trong trình duyệt của bạn. API key chỉ nằm trong trình duyệt và chỉ được gửi tới nhà cung cấp bạn đã chọn (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek hoặc URL tương thích OpenAI). Lưu ý: nếu bật "nhớ khóa", khóa được lưu trong `localStorage` của trình duyệt cho origin `namnhfreelancer.github.io`, origin này dùng chung với các trang GitHub Pages khác của chủ repo; trên máy dùng chung hoặc nếu bạn không muốn vậy, hãy để ô này không chọn.
- **Tự mang API key (BYOK):** ứng dụng ước tính token và chi phí trước khi dịch, tự tạo hướng dẫn văn phong và bảng thuật ngữ (chỉnh sửa được), có chế độ rà soát 2 lượt, lưu tiến độ liên tục nên tải lại trang vẫn dịch tiếp.
- **Xem trước** EPUB ngay trong trình duyệt (cỡ Kindle, điện thoại, máy tính bảng hoặc máy tính; nền sáng, giấy cũ hoặc tối; lật trang hoặc cuộn; cỡ chữ; mục lục và tìm kiếm). Bấm vào một đoạn để mở nó trong trình sửa; đoạn lỗi được tô nổi. Các tuỳ chọn này chỉ dùng cho bản xem trước, không đưa vào tệp xuất.
- **Bảng thuật ngữ dạng tệp:** xuất CSV/JSON, nhập CSV/TSV/JSON (gộp hoặc thay thế) để dùng lại cho cả bộ sách; CLI có `--glossary-file` và `epubtrans glossary export`. Đổi ngôn ngữ đích khi sách đã có bản dịch sẽ hỏi giữ nguyên hay đặt lại về chờ dịch. Bản dịch giống hệt bản gốc được đánh dấu cảnh báo (đếm và lọc riêng với lỗi). Token từ cache prompt được tính riêng và theo giá ưu đãi; có tùy chọn suy luận (mặc định/thấp/tắt) cho mô hình suy luận. Nếu nhà cung cấp không nhận mức "tắt", ứng dụng thử mức `minimal` rồi mới gửi không kèm tùy chọn này. Nhiều thẻ mở cùng một sách luôn dùng chung cài đặt đã lưu: đổi ngôn ngữ đích ở một thẻ thì các thẻ khác cập nhật theo, và bản dịch vào ngôn ngữ cũ đang chạy dở sẽ bị bỏ.
- **Nhập TXT/Markdown:** tệp Markdown không có dòng trống được tách mỗi dòng một đoạn; dòng `---` ở đầu tệp chỉ được coi là front matter khi phần bên trong đúng là YAML, nếu không thì là dấu ngắt cảnh; đoạn văn quá dài được cắt ở cuối câu để vừa một lượt trả lời của mô hình.
- **Xuất EPUB** ở 3 chế độ: song ngữ, song ngữ (bản dịch trước), chỉ bản dịch. Giao diện có tiếng Việt và tiếng Anh, cài được như ứng dụng (PWA).
- **Dòng lệnh:** cài bằng lệnh ở mục [Command line](#command-line), đặt khóa trong biến môi trường `EPUBTRANS_API_KEY`, rồi chạy `epubtrans translate sach.epub --to vi --model <id>` (nhà cung cấp mặc định là `openai`; dùng nhà cung cấp khác thì thêm `--provider <id>` ở mỗi lần chạy). Gặp sự cố hoặc nhấn Ctrl-C, chạy lại cùng lệnh để dịch tiếp; có thể mở tệp `.epubtrans` xuất từ web bằng `epubtrans resume`.
- **Bảng thuật ngữ và hướng dẫn văn phong:** ứng dụng quét toàn bộ sách (không tốn lượt gọi mô hình) để tìm tên riêng và thuật ngữ lặp lại, rồi nhờ mô hình phân loại (nhân vật, địa danh, tổ chức, thuật ngữ, khác) và dịch chúng; số mục tăng theo độ dài sách (khoảng 1 mục cho mỗi 500 từ, tối đa 400 theo mặc định). Hướng dẫn văn phong được viết từ khoảng 18 đoạn trích khắp cuốn sách, theo các mục cố định, trong đó có cách xưng hô giữa các nhân vật; hướng dẫn bạn đang dùng được giữ nguyên, phần tạo ra được thêm bên dưới. Mỗi yêu cầu dịch chỉ gửi kèm những thuật ngữ xuất hiện trong đoạn đó.
- **Dùng với tác tử AI (WebMCP, thử nghiệm):** trên Chrome/Edge 149 trở lên có bật cờ `chrome://flags/#enable-webmcp-testing`, tác tử AI chạy trong trình duyệt có thể gọi các thao tác chính của ứng dụng: nhập sách từ URL https, chọn mô hình, dịch mẫu, dịch, sửa đoạn lỗi, xuất EPUB. Tác tử không bao giờ đọc hay đặt API key, và không đổi được URL tùy chỉnh. Muốn dịch cả cuốn (tốn phí), xóa sách hay tải sách từ một máy chủ, bạn phải tự xác nhận trong trang. Ở các trình duyệt khác, ứng dụng không thay đổi gì. Chi tiết: [Use with AI agents (WebMCP)](#use-with-ai-agents-webmcp).

Cảm ơn tác giả gốc [nguyenvanduocit](https://github.com/nguyenvanduocit/epubtrans). Điều khoản sử dụng xem tệp [LICENSE](LICENSE).
