# epubtrans

[![CI](https://github.com/namnhfreelancer/epubtrans/actions/workflows/ci.yml/badge.svg)](https://github.com/namnhfreelancer/epubtrans/actions/workflows/ci.yml)

Translate DRM-free books into **bilingual EPUB** with the AI model of your choice, in the browser or from the command line.

- **Web app (no install, no server):** <https://namnhfreelancer.github.io/epubtrans/>
- **CLI (single binary):** Linux, macOS and Windows, see [Command line](#command-line)
- Input: EPUB, MOBI, AZW3 and FB2 (DRM-free). Output: valid EPUB 3 (checked with [epubcheck](https://www.w3.org/publishing/epubcheck/)).
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

## Web app

1. Open the app and add your provider, API key and model (the key stays in the browser; see the "remember key" caveat under [Privacy](#privacy)).
2. Drop in a book. The source language is detected automatically; pick the target language.
3. Optionally let the model draft a **style guideline and glossary** for the book, then edit them; start from a preset (general, fiction, technical, psychology) if you prefer. Turn on the **2-pass review** for higher quality.
4. Check the token and cost estimate, then translate. Progress is saved continuously: reload or close the tab and it resumes without redoing finished segments.
5. Read side by side, edit any segment, or re-translate a single segment.
6. Export the EPUB as **bilingual** (original, then translation, original faded), **bilingual-translation-first**, or **translation-only**.

The library keeps several books. Each book can be exported to, and imported from, a `.epubtrans` project file. The interface is available in English and Vietnamese and the app is an installable PWA.

### Glossary and style guideline

"Generate guideline & glossary" (web) and `--generate-guide` (CLI) work in three steps:

1. **Scan (local, no model call).** The whole book is scanned for glossary candidates: multi-word names ("Ministry of Magic", "Mr. Darcy"), capitalized words that recur mid-sentence, and frequent phrases such as "natural selection" (Chinese, Japanese and Korean: frequent character sequences). Each candidate keeps its frequency and up to two short context snippets.
2. **Guideline.** One request with about 18 passages spread across the book returns a guideline with fixed sections: genre & audience, tone & register, forms of address & pronouns (for Vietnamese the *xưng hô* pair per relationship), names policy, dialogue & quotation marks, honorifics & titles, units/numbers/dates, chapter titles & headings, footnotes, and terms to keep untranslated. Your current guideline (a preset or your own text) is kept as is; the generated part is added below it under `## Book-specific guideline`, and generating again replaces only that part.
3. **Glossary.** The model classifies the candidates in batches of 80 (person, place, organization, term, other), translates the real terms and drops the rest. Entries you already have are kept and win over duplicates. The glossary grows with the book: about one entry per 500 words, at least 30, at most 400 by default (web: "Max glossary entries").

Each translation request only carries the glossary entries whose term occurs in that batch (whole-word, case-insensitive; the review pass also checks the draft), so a large glossary does not inflate every request. Generation costs one request plus one per 80 candidates: for a 1000-page book about 11 requests, roughly 100k input and 20k output tokens (about $0.60 at $3/$15 per 1M tokens); a short book needs 2 requests. The web glossary table has search, a type filter and pages of 50 rows.

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

Common options: `--from <lang>` (default auto), `--provider <preset id>`, `--base-url <url>`, `--model <id>`, `--concurrency <1-16>`, `--two-pass`, `--guideline-preset general|fiction|technical|psychology`, `--guideline-file <path>`, `--generate-guide`, `--mode bilingual|bilingual-translation-first|translation-only`, `--out <file.epub>`, `--project <file>`, `--price-in/--price-out <USD per 1M tokens>`, `--yes`. Run `epubtrans <command> --help` for details.

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

epubtrans was created by [nguyenvanduocit](https://github.com/nguyenvanduocit/epubtrans); v2 and its prompt presets are his work. This v3 rewrite (TypeScript monorepo, browser app, new CLI) builds on that project and keeps its attribution. The MOBI/KF8 parser is vendored from [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), see `packages/core/third-party/foliate-js/`.

See [LICENSE](LICENSE) for the terms that apply to this repository.

---

## Tiếng Việt

epubtrans dịch sách **không DRM** (EPUB, MOBI, AZW3, FB2) thành **EPUB song ngữ** bằng mô hình AI mà bạn chọn, ngay trong trình duyệt hoặc bằng dòng lệnh.

- **Dùng thử không cần cài đặt:** <https://namnhfreelancer.github.io/epubtrans/>
- **Riêng tư:** không có máy chủ. Sách và tiến độ dịch lưu trong trình duyệt của bạn. API key chỉ nằm trong trình duyệt và chỉ được gửi tới nhà cung cấp bạn đã chọn (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek hoặc URL tương thích OpenAI). Lưu ý: nếu bật "nhớ khóa", khóa được lưu trong `localStorage` của trình duyệt cho origin `namnhfreelancer.github.io`, origin này dùng chung với các trang GitHub Pages khác của chủ repo; trên máy dùng chung hoặc nếu bạn không muốn vậy, hãy để ô này không chọn.
- **Tự mang API key (BYOK):** ứng dụng ước tính token và chi phí trước khi dịch, tự tạo hướng dẫn văn phong và bảng thuật ngữ (chỉnh sửa được), có chế độ rà soát 2 lượt, lưu tiến độ liên tục nên tải lại trang vẫn dịch tiếp.
- **Xuất EPUB** ở 3 chế độ: song ngữ, song ngữ (bản dịch trước), chỉ bản dịch. Giao diện có tiếng Việt và tiếng Anh, cài được như ứng dụng (PWA).
- **Dòng lệnh:** cài bằng lệnh ở mục [Command line](#command-line), đặt khóa trong biến môi trường `EPUBTRANS_API_KEY`, rồi chạy `epubtrans translate sach.epub --to vi --model <id>` (nhà cung cấp mặc định là `openai`; dùng nhà cung cấp khác thì thêm `--provider <id>` ở mỗi lần chạy). Gặp sự cố hoặc nhấn Ctrl-C, chạy lại cùng lệnh để dịch tiếp; có thể mở tệp `.epubtrans` xuất từ web bằng `epubtrans resume`.
- **Bảng thuật ngữ và hướng dẫn văn phong:** ứng dụng quét toàn bộ sách (không tốn lượt gọi mô hình) để tìm tên riêng và thuật ngữ lặp lại, rồi nhờ mô hình phân loại (nhân vật, địa danh, tổ chức, thuật ngữ, khác) và dịch chúng; số mục tăng theo độ dài sách (khoảng 1 mục cho mỗi 500 từ, tối đa 400 theo mặc định). Hướng dẫn văn phong được viết từ khoảng 18 đoạn trích khắp cuốn sách, theo các mục cố định, trong đó có cách xưng hô giữa các nhân vật; hướng dẫn bạn đang dùng được giữ nguyên, phần tạo ra được thêm bên dưới. Mỗi yêu cầu dịch chỉ gửi kèm những thuật ngữ xuất hiện trong đoạn đó.

Cảm ơn tác giả gốc [nguyenvanduocit](https://github.com/nguyenvanduocit/epubtrans). Điều khoản sử dụng xem tệp [LICENSE](LICENSE).
