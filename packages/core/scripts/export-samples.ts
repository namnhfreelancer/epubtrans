/**
 * Writes every fixture book, translated by the echo test translator, in every export mode to `test-output/`,
 * plus the hint-capable modes with Word Wise hints (glossed by a mock model) in the ruby and the inline style, with an
 * XML-invalid character planted in one gloss and one translation.
 * CI runs epubcheck over the result to prove exported EPUBs are valid.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXPORT_MODES, exportEpub, generateProjectWordHints, HINT_EXPORT_MODES, importBook, planWordHints, translateProject } from '../src';
import { answerAll, env, glossProvider, mockProvider, readFixture, readFrequencyList } from '../test/test-helpers';

const FIXTURES = ['a-modest-proposal.epub', 'a-modest-proposal.mobi', 'a-modest-proposal.azw3', 'aesop-fables.fb2'];
const outDir = fileURLToPath(new URL('../test-output/', import.meta.url));
mkdirSync(outDir, { recursive: true });

for (const name of FIXTURES) {
  const project = await importBook(readFixture(name), name, env);
  const settings = { ...project.settings, model: 'mock-model', sourceLang: 'en', targetLang: 'vi' };
  await translateProject(project, mockProvider(answerAll), settings);
  const base = `${outDir}${name.replace(/\./g, '-')}`;
  for (const mode of EXPORT_MODES) {
    const file = `${base}.${mode}.epub`;
    writeFileSync(file, await exportEpub(project, mode, env));
    console.log(`wrote ${file}`);
  }

  project.settings = { ...settings, wordHints: { enabled: true, level: 5, style: 'ruby', maxPerParagraph: 3, perChapter: 2 } };
  const plan = planWordHints(project, readFrequencyList('en'), project.settings);
  await generateProjectWordHints(project, plan, glossProvider(), project.settings);
  // XML-invalid characters, as a crafted project file or a misbehaving model could store them: export must drop them.
  const glossed = project.wordHints?.entries.find((e) => e.senses.length > 0);
  if (glossed?.senses[0]) glossed.senses[0].gloss += '\uFFFF';
  const translated = project.chapters.flatMap((c) => c.segments).find((s) => s.translationHtml);
  if (translated) translated.translationHtml = `${translated.translationHtml}\uFFFE`;
  for (const style of ['ruby', 'inline'] as const) {
    const wordHints = { enabled: true, level: 5, style, maxPerParagraph: 3, perChapter: 2 };
    for (const mode of HINT_EXPORT_MODES) {
      const file = `${base}.${mode}.hints-${style}.epub`;
      writeFileSync(file, await exportEpub({ ...project, settings: { ...project.settings, wordHints } }, mode, env));
      console.log(`wrote ${file}`);
    }
  }
}
