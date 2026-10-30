export const MAIN_HELP = `epubtrans - translate DRM-free EPUB, MOBI, AZW3 and FB2 books into bilingual EPUB

Usage
  epubtrans translate <input> --to <lang> --model <id> [options]
  epubtrans resume <file.epubtrans> [options]
  epubtrans export <file.epubtrans> [--mode <mode>] [--out file.epub]
  epubtrans models [--provider <id>] [--base-url <url>]
  epubtrans presets
  epubtrans --version | --help

API key
  Set EPUBTRANS_API_KEY (or OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY,
  DEEPSEEK_API_KEY), or pass --api-key-file <path> (use - for stdin). The key is never accepted as an
  argument and never printed. It is only sent to the provider's own endpoint.
  When the provider comes from a project file (no --provider on this run), EPUBTRANS_API_KEY is not used:
  set that provider's own variable, pass --api-key-file, or pass --provider <id> explicitly.

Run "epubtrans <command> --help" for the options of a command.
`;

const PROVIDER_OPTIONS = `  --provider <id>          Provider preset (see: epubtrans presets). Default: the project's, else openai,
                           or custom when only --base-url is given
  --base-url <url>         Override the provider endpoint (OpenAI-compatible, or Anthropic for the anthropic preset).
                           Required on every run for custom; a project file's endpoint is never used
  --model <id>             Model id (list them with: epubtrans models)
  --api-key-file <path>    Read the API key from a file (- for stdin)`;

const RUN_OPTIONS = `  --concurrency <n>        Parallel requests, 1-16 (default 3)
  --two-pass               Add a review pass over every translation
  --price-in <usd>         USD per 1M input tokens, for the cost estimate
  --price-out <usd>        USD per 1M output tokens (OpenRouter prices are looked up automatically)
  --mode <mode>            bilingual (default) | bilingual-translation-first | translation-only
  --out <file.epub>        Output path (default: <input>.<lang>.epub)
  -y, --yes                Start without asking for confirmation after the estimate`;

export const COMMAND_HELP: Record<string, string> = {
  translate: `Usage: epubtrans translate <input.(epub|mobi|azw3|fb2)> --to <lang> --model <id> [options]

Imports the book, prints a token/cost estimate, asks for confirmation, translates, and writes a
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

Exit codes: 0 done, 1 error or cancelled, 2 usage error, 3 finished with untranslated segments, 130 interrupted.
`,
  resume: `Usage: epubtrans resume <file.epubtrans> [options]

Continues a project created by the web app or an earlier run (finished segments are skipped), updates the
project file in place and writes the EPUB.

Options
${PROVIDER_OPTIONS}
${RUN_OPTIONS}
`,
  export: `Usage: epubtrans export <file.epubtrans> [options]

Writes the EPUB from a project as it stands. Untranslated segments keep their source text. No API key needed.

Options
  --mode <mode>            bilingual (default) | bilingual-translation-first | translation-only
  --out <file.epub>        Output path (default: <project>.<lang>.epub)
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
