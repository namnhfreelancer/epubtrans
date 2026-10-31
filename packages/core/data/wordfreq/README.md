# Word frequency lists (Word Wise hints)

One file per source language: a `#` header line, then one lowercase word per line, most frequent first (line number = frequency rank). Word Wise hints use them to pick the difficult words of a book locally.

| Language | File | Words | wordfreq list |
|----------|------|-------|---------------|
| English | `en.txt` | 100,000 | `large_en` |
| French, German, Spanish, Italian, Portuguese, Russian, Dutch, Polish, Swedish, Ukrainian, Czech, Japanese, Chinese (Simplified) | `<lang>.txt` | 30,000 | `large_<lang>` |
| Korean | `ko.txt` | 29,925 (all word-like entries) | `small_ko` |

English is deeper because its lemmatizer checks base forms against the list ("obfuscated" → "obfuscate", rank about 67,000). Total size about 4.7 MB.

## Source and license

Generated from the published data of [wordfreq](https://github.com/rspeer/wordfreq) v3.2 by Robyn Speer et al. by `scripts/generate-word-frequency-lists.ts` (not run in CI; run it only to change languages, sizes or the wordfreq version). Only word-like tokens are kept: letters and marks with inner apostrophes, no digits, no hyphenated compounds.

The wordfreq data is licensed under the [Creative Commons Attribution-ShareAlike 4.0 International license](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0); wordfreq's code is Apache-2.0. These derived lists are therefore distributed under CC BY-SA 4.0 as well, with this attribution. The share-alike terms apply to these data files, not to the rest of epubtrans. wordfreq includes data from SUBTLEX and other sources under the permissions described in its own README and NOTICE.
