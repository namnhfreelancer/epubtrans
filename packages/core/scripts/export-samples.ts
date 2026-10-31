/**
 * Writes every fixture book (plus a generated EPUB 2 book), translated by the echo test translator, in every export mode
 * to `test-output/`, plus the hint-capable modes with Word Wise hints (glossed by a mock model) in the ruby and the
 * inline style, with an XML-invalid character planted in one gloss and one translation (raw and as character
 * references). Styled exports follow: every preset, and a custom style with two embedded fonts and the attribution page
 * in every mode. CI runs epubcheck over the result to prove exported EPUBs are valid.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_MODES,
  EXPORT_STYLE_PRESET_IDS,
  type ExportStyle,
  exportEpub,
  exportStylePreset,
  generateProjectWordHints,
  HINT_EXPORT_MODES,
  importBook,
  planWordHints,
  translateProject,
} from '../src';
import { buildEpub2Book } from '../test/epub2-fixture';
import { answerAll, env, glossProvider, loadFontFile, mockProvider, readFixture, readFrequencyList } from '../test/test-helpers';

const FIXTURES: [string, Uint8Array][] = [
  ...['a-modest-proposal.epub', 'a-modest-proposal.mobi', 'a-modest-proposal.azw3', 'aesop-fables.fb2'].map((n): [string, Uint8Array] => [n, readFixture(n)]),
  ['epub2-sample.epub', buildEpub2Book()],
];

/** Every style field set, with a bundled font for each block (two fonts embedded). */
const CUSTOM_STYLE: ExportStyle = {
  source: { color: '#555555', opacity: 0.8, fontSizePercent: 90, italic: true, font: 'literata' },
  translation: { color: 'rgb(20, 40, 60)', font: 'be-vietnam-pro', fontWeight: 600, fontSizePercent: 110 },
  blockSpacingEm: 0.6,
  hint: { color: '#1f7a8c', fontSizePercent: 70 },
};

const outDir = fileURLToPath(new URL('../test-output/', import.meta.url));
mkdirSync(outDir, { recursive: true });

for (const [name, bytes] of FIXTURES) {
  const project = await importBook(bytes, name, env);
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
  if (glossed?.senses[0]) glossed.senses[0].gloss += '￿';
  const translated = project.chapters.flatMap((c) => c.segments).find((s) => s.translationHtml);
  // Also as character references, which the HTML parser decodes into raw characters.
  if (translated) translated.translationHtml = `${translated.translationHtml}￾&#xFFFE;<span title="a&#1;b">c&#1;d</span>`;
  for (const style of ['ruby', 'inline'] as const) {
    const wordHints = { enabled: true, level: 5, style, maxPerParagraph: 3, perChapter: 2 };
    for (const mode of HINT_EXPORT_MODES) {
      const file = `${base}.${mode}.hints-${style}.epub`;
      writeFileSync(file, await exportEpub({ ...project, settings: { ...project.settings, wordHints } }, mode, env));
      console.log(`wrote ${file}`);
    }
  }

  for (const preset of EXPORT_STYLE_PRESET_IDS) {
    const file = `${base}.bilingual.style-${preset}.epub`;
    writeFileSync(file, await exportEpub({ ...project, settings: { ...project.settings, exportStyle: exportStylePreset(preset) } }, 'bilingual', env));
    console.log(`wrote ${file}`);
  }
  const styled = { ...project, settings: { ...project.settings, exportStyle: CUSTOM_STYLE, attribution: true } };
  for (const mode of EXPORT_MODES) {
    const file = `${base}.${mode}.styled-fonts-attribution.epub`;
    writeFileSync(file, await exportEpub(styled, mode, env, { loadFontFile }));
    console.log(`wrote ${file}`);
  }
}
