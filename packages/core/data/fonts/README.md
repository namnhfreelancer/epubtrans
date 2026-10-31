# Embeddable fonts (export styles)

Fonts an export style can embed in the EPUB (per block: original or translation). Each family has a regular, an italic and a bold face; readers synthesize bold italic. All cover Latin, Latin Extended and every Vietnamese letter.

| Family | Files | Size (3 faces) | Generic fallback |
|--------|-------|----------------|------------------|
| Literata | `literata-{regular,italic,bold}.ttf` | 288 KB | serif |
| Noto Serif | `noto-serif-{regular,italic,bold}.ttf` | 477 KB | serif |
| Be Vietnam Pro | `be-vietnam-pro-{regular,italic,bold}.ttf` | 201 KB | sans-serif |
| Noto Sans | `noto-sans-{regular,italic,bold}.ttf` | 402 KB | sans-serif |

The exact byte sizes are listed in `src/export-style/embedded-fonts.ts` (a test keeps them in sync), so the apps can show the added size before an export. Fonts are compressed inside the EPUB zip, so the real increase is smaller.

## Source and license

Built from the official Google Fonts repository (<https://github.com/google/fonts>, `ofl/literata`, `ofl/notoserif`, `ofl/bevietnampro`, `ofl/notosans`, commit `6c1dbe27`, 2026-10-31) by `scripts/subset-embedded-fonts.py`: variable fonts are pinned to static instances (weight 400 or 700, default optical size and width), then subset to Latin, Latin Extended, Vietnamese and common punctuation, without hinting. The script is not run in CI; run it only to update a font.

All four families are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/) by their authors (Literata: The Literata Project Authors; Noto Serif and Noto Sans: The Noto Project Authors; Be Vietnam Pro: The Be Vietnam Pro Project Authors). None declares a Reserved Font Name, so the subsets keep the original names. Each family's license is the `<family>-OFL.txt` file next to its fonts, and export copies it into every EPUB that embeds the family (`epubtrans-fonts/<family>-OFL.txt`). The OFL allows bundling, embedding and redistributing the fonts with other software and in documents; it does not apply to the rest of epubtrans. Fonts are embedded plainly, never obfuscated.
