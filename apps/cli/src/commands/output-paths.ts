import { resolve } from 'node:path';
import { UsageError } from '../args';

const BOOK_EXTENSIONS = /\.(epub|mobi|azw3|fb2)$/i;
export const PROJECT_EXTENSION = '.epubtrans';

/** `books/dune.epub` or `books/dune.epub.epubtrans` -> `books/dune.<lang>.epub`. */
export function defaultOutPath(sourcePath: string, targetLang: string): string {
  const base = sourcePath.replace(/\.epubtrans$/i, '').replace(BOOK_EXTENSIONS, '');
  return `${base}.${targetLang}.epub`;
}

/** The output must never replace the book or the project it is built from. */
export function assertOutputIsSeparate(outPath: string, ...inputs: string[]): void {
  const out = resolve(outPath);
  for (const input of inputs) {
    if (resolve(input) === out) throw new UsageError(`--out ${outPath} would overwrite ${input}; choose another path`);
  }
}
