export const MAIN_HELP = `epubtrans - translate DRM-free EPUB, MOBI, AZW3, FB2, TXT and Markdown books into bilingual EPUB

Usage
  epubtrans translate <input> --to <lang> --model <id> [options]
  epubtrans resume <file.epubtrans> [options]
  epubtrans sample <input | file.epubtrans> [--passages N] [--words N] [--seed S] [--new] [options]
  epubtrans export <file.epubtrans> [--mode <mode>] [--out file.epub]
  epubtrans glossary export <file.epubtrans> --out <glossary.csv|.tsv|.json>
  epubtrans models [--provider <id>] [--base-url <url>]
  epubtrans presets
  epubtrans --version | --help

API key
  Set EPUBTRANS_API_KEY (or OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY,
  DEEPSEEK_API_KEY), or pass --api-key-file <path> (use - for stdin). The key is never accepted as an
  argument and never printed. It is only sent to the provider's own endpoint.
  When a non-default provider (default: openai) comes only from a project file (no --provider on this run),
  EPUBTRANS_API_KEY is not used: set that provider's own variable, pass --api-key-file, or pass
  --provider <id> explicitly.

Run "epubtrans <command> --help" for the options of a command.
`;

const PROVIDER_OPTIONS = `  --provider <id>          Provider preset (see: epubtrans presets). Default: the project's, else openai,
                           or custom when only --base-url is given
  --base-url <url>         Override the provider endpoint (OpenAI-compatible, or Anthropic for the anthropic preset).
                           Required on every run for custom; a project file's endpoint is never used
  --model <id>             Model id (list them with: epubtrans models)
  --api-key-file <path>    Read the API key from a file (- for stdin)`;

const REASONING_OPTION = `  --reasoning <level>      default (provider default) | low | off, for reasoning models. An endpoint that rejects the
                           setting is asked again without it (once per session); that never stops the run`;

const RUN_OPTIONS = `  --concurrency <n>        Parallel requests, 1-16 (default 3)
  --two-pass               Add a review pass over every translation
  --price-in <usd>         USD per 1M input tokens, for the cost estimate
  --price-out <usd>        USD per 1M output tokens
  --cached-ratio <r>       Price of cached input tokens as a fraction of --price-in, 0-2 (default: the provider's
                           documented discount, e.g. 0.1 for Anthropic, else 1). Cached tokens are shown separately
  --max-segments <n>       Most segments per request, 1-200 (default 32), on top of the token budget
  --identical-min-letters <n>
                           Warn about translations identical to the source with at least n letters (default 12, 0 = off)
${REASONING_OPTION}
  --no-price-lookup        Do not look up missing prices in public catalogs (OpenRouter, then LiteLLM). The lookup is a
                           plain GET that sends no API key; matched id and prices are printed before the estimate
  --mode <mode>            bilingual (default) | bilingual-translation-first | translation-only
  --out <file.epub>        Output path (default: <input>.<lang>.epub)
  -y, --yes                Start without asking for confirmation after the estimate`;

export const COMMAND_HELP: Record<string, string> = {
  translate: `Usage: epubtrans translate <input.(epub|mobi|azw3|fb2|txt|md)> --to <lang> --model <id> [options]

Imports the book (TXT and Markdown are converted to EPUB: chapters from headings or "Chapter N" lines), prints a token/cost estimate, asks for confirmation, translates, and writes a
bilingual EPUB. Progress is saved continuously to the project file; after Ctrl-C or a crash, run the
same command again to continue without re-translating finished segments.

Options
  --to <lang>              Target language, e.g. vi, en, fr, pt-BR (required for a new project)
  --from <lang>            Source language (default: auto-detect)
  --project <file>         Project file (default: <input>.epubtrans)
${PROVIDER_OPTIONS}
${RUN_OPTIONS}
  --guideline-preset <id>  general (default) | fiction | technical | psychology
  --guideline-file <path>  Use your own style guideline text
  --generate-guide         After you confirm, ask the model for a book-specific guideline and glossary first
  --glossary-file <path>   Merge a glossary file (.csv, .tsv/.txt or .json; columns term, translation, type, note) into
                           the project; entries already in the project are kept

Exit codes: 0 done, 1 error or cancelled, 2 usage error, 3 finished with untranslated segments, 130 interrupted.
`,
  resume: `Usage: epubtrans resume <file.epubtrans> [options]

Continues a project created by the web app or an earlier run (finished segments are skipped), updates the
project file in place and writes the EPUB.

Options
${PROVIDER_OPTIONS}
${RUN_OPTIONS}
`,
  sample: `Usage: epubtrans sample <input.(epub|mobi|azw3|fb2|txt|md) | file.epubtrans> --to <lang> --model <id> [options]

Translates a few passages from different chapters of the book (default: 5 passages of about 350 words) so you
can judge the quality before the full run. Prints an estimate for just the sample and asks for confirmation,
then prints every passage as source/translation pairs. The passages are saved in the project file
(<input>.epubtrans, created if missing); "translate" and "resume" skip them afterwards.

Run the command again without selection options to translate the same passages once more, for example
after editing the guideline in the project (the sampled segments are always translated again).

Options
  --to <lang>              Target language (required for a new project)
  --from <lang>            Source language (default: auto-detect)
  --project <file>         Project file (default: <input>.epubtrans)
  --passages <n>           Number of passages, each from a different chapter, 1-50 (default 5)
  --words <n>              Source words per passage, 20-5000 (default 350)
  --seed <n>               Seed that picks the passages (same seed, same passages)
  --new                    Pick new random passages instead of repeating the stored ones
  --glossary-file <path>   Merge a glossary file (.csv, .tsv/.txt or .json; columns term, translation, type, note) into
                           the project; entries already in the project are kept
${PROVIDER_OPTIONS}
  --concurrency <n>        Parallel requests, 1-16 (default 3)
  --two-pass               Add a review pass over every translation
  --price-in <usd>         USD per 1M input tokens, for the cost estimate
  --price-out <usd>        USD per 1M output tokens
  --cached-ratio <r>       Price of cached input tokens as a fraction of --price-in, 0-2 (default: the provider's
                           documented discount, e.g. 0.1 for Anthropic, else 1). Cached tokens are shown separately
  --max-segments <n>       Most segments per request, 1-200 (default 32), on top of the token budget
  --identical-min-letters <n>
                           Warn about translations identical to the source with at least n letters (default 12, 0 = off)
${REASONING_OPTION}
  -y, --yes                Start without asking for confirmation after the estimate

Exit codes: 0 done, 1 error or cancelled, 2 usage error, 3 some sample segments failed, 130 interrupted.
`,
  export: `Usage: epubtrans export <file.epubtrans> [options]

Writes the EPUB from a project as it stands. Untranslated segments keep their source text. No API key needed.

Options
  --mode <mode>            bilingual (default) | bilingual-translation-first | translation-only
  --out <file.epub>        Output path (default: <project>.<lang>.epub)
`,
  glossary: `Usage: epubtrans glossary export <file.epubtrans> --out <file> [--format csv|tsv|json]

Writes the project's glossary (term, translation, type, note) as CSV, TSV or JSON, for another book of a series
(translate/sample --glossary-file) or the web app's glossary import. The format follows the --out extension.
Cells that a spreadsheet would run as a formula are prefixed with ' (removed again on import).
`,
  models: `Usage: epubtrans models [--provider <id>] [--base-url <url>] [--api-key-file <path>]

Lists model ids from the provider's /models endpoint, one per line.

Options
${PROVIDER_OPTIONS}
`,
  presets: `Usage: epubtrans presets

Lists provider presets (with the environment variable holding each key), guideline presets and export modes.
`,
};
