/**
 * Writes every fixture book, translated by the echo test translator, in every export mode
 * to `test-output/`. CI runs epubcheck over the result to prove exported EPUBs are valid.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXPORT_MODES, exportEpub, importBook, translateProject } from '../src';
import { answerAll, env, mockProvider, readFixture } from '../test/test-helpers';

const FIXTURES = ['a-modest-proposal.epub', 'a-modest-proposal.mobi', 'a-modest-proposal.azw3', 'aesop-fables.fb2'];
const outDir = fileURLToPath(new URL('../test-output/', import.meta.url));
mkdirSync(outDir, { recursive: true });

for (const name of FIXTURES) {
  const project = await importBook(readFixture(name), name, env);
  const settings = { ...project.settings, model: 'mock-model', sourceLang: 'en', targetLang: 'vi' };
  await translateProject(project, mockProvider(answerAll), settings);
  for (const mode of EXPORT_MODES) {
    const file = `${outDir}${name.replace(/\./g, '-')}.${mode}.epub`;
    writeFileSync(file, await exportEpub(project, mode, env));
    console.log(`wrote ${file}`);
  }
}
