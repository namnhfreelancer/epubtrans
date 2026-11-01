import { describe, expect, test } from 'bun:test';
import { createDefaultSettings } from '@epubtrans/core';
import { expectPositionals, parseArgs, UsageError } from '../src/args';
import { defaultOutPath } from '../src/commands/output-paths';
import { RUN_FLAGS, TRANSLATE_FLAGS } from '../src/flag-specs';
import { applyRunFlags, parseExportMode, parseLanguage, selectProvider } from '../src/settings';

describe('parseArgs', () => {
  test('reads positionals, spaced and = values, numbers and booleans', () => {
    const { positionals, flags } = parseArgs(
      ['book.epub', '--to', 'vi', '--model=gpt-x', '--concurrency', '4', '--two-pass', '--price-in', '0.5', '-y'],
      TRANSLATE_FLAGS,
    );
    expect(positionals).toEqual(['book.epub']);
    expect(flags).toEqual({ to: 'vi', model: 'gpt-x', concurrency: 4, 'two-pass': true, 'price-in': 0.5, yes: true });
  });

  test('everything after -- is positional', () => {
    expect(parseArgs(['--yes', '--', '--weird-name.epub'], RUN_FLAGS).positionals).toEqual(['--weird-name.epub']);
  });

  test('rejects unknown options, missing and malformed values', () => {
    expect(() => parseArgs(['--nope'], RUN_FLAGS)).toThrow('Unknown option: --nope');
    expect(() => parseArgs(['-z'], RUN_FLAGS)).toThrow('Unknown option: -z');
    expect(() => parseArgs(['--model'], RUN_FLAGS)).toThrow('--model needs a value');
    expect(() => parseArgs(['--model', '--yes'], RUN_FLAGS)).toThrow('--model needs a value');
    expect(() => parseArgs(['--concurrency', 'many'], RUN_FLAGS)).toThrow('must be a number');
    expect(() => parseArgs(['--yes=maybe'], RUN_FLAGS)).toThrow('does not take a value');
  });

  test('negative numbers are values, not flags (range checks happen later)', () => {
    expect(parseArgs(['--price-in', '-1'], RUN_FLAGS).flags['price-in']).toBe(-1);
  });

  test('refuses API keys on the command line and points to safe alternatives', () => {
    for (const flag of ['--api-key', '--api-key=sk-secret', '--key', '--token']) {
      let message = '';
      try {
        parseArgs([flag, 'sk-secret'], RUN_FLAGS);
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        message = (err as Error).message;
      }
      expect(message).toContain('EPUBTRANS_API_KEY');
      expect(message).toContain('--api-key-file');
      expect(message).not.toContain('sk-secret');
    }
  });

  test('expectPositionals reports missing and extra arguments', () => {
    expect(() => expectPositionals([], 1, 'usage')).toThrow('Missing argument');
    expect(() => expectPositionals(['a', 'b'], 1, 'usage')).toThrow('Unexpected argument "b"');
  });
});

describe('settings helpers', () => {
  test('provider defaults: openai, custom for a bare --base-url, project provider on resume', () => {
    expect(selectProvider({}).preset.id).toBe('openai');
    expect(selectProvider({ 'base-url': 'http://localhost:11434/v1' }).preset.id).toBe('custom');
    const current = { providerId: 'deepseek', baseURL: 'https://proxy.example/v1' };
    expect(selectProvider({}, current).preset.id).toBe('deepseek');
    expect(selectProvider({ provider: 'openrouter' }, current).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(() => selectProvider({ provider: 'nope' })).toThrow('Unknown provider');
    expect(() => selectProvider({ provider: 'custom' })).toThrow('needs --base-url');
  });

  test('the endpoint stored in a project file is never used: presets keep their own, custom needs --base-url', () => {
    const stored = { providerId: 'openrouter', baseURL: 'http://127.0.0.1:1/v1' };
    expect(selectProvider({}, stored).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(selectProvider({ 'base-url': 'http://localhost:9/v1' }, stored).baseURL).toBe('http://localhost:9/v1');
    const custom = { providerId: 'custom', baseURL: 'http://127.0.0.1:1/v1' };
    expect(() => selectProvider({}, custom)).toThrow('needs --base-url on every run');
    expect(selectProvider({ 'base-url': 'http://localhost:9/v1' }, custom).baseURL).toBe('http://localhost:9/v1');
  });

  test('run flags override only what was passed', () => {
    const base = createDefaultSettings({ model: 'm1', concurrency: 3 });
    const selection = selectProvider({ provider: 'anthropic' });
    const next = applyRunFlags(base, { concurrency: 8, 'two-pass': true, 'price-in': 1, 'price-out': 2 }, selection);
    expect(next).toMatchObject({ model: 'm1', concurrency: 8, twoPass: true, priceInPerM: 1, priceOutPerM: 2, providerId: 'anthropic' });
    expect(applyRunFlags(base, { model: ' m2 ' }, selection).model).toBe('m2');
    expect(applyRunFlags(base, {}, selection).twoPass).toBe(false);
    expect(() => applyRunFlags(base, { concurrency: 0 }, selection)).toThrow('--concurrency');
    expect(() => applyRunFlags(base, { concurrency: 2.5 }, selection)).toThrow('--concurrency');
    expect(() => applyRunFlags(base, { 'price-out': -1 }, selection)).toThrow('negative');
  });

  test('--polish is an alias of --two-pass: both turn the polish pass on, neither turns a saved one off', () => {
    const base = createDefaultSettings({ model: 'm1' });
    const selection = selectProvider({ provider: 'anthropic' });
    expect(parseArgs(['book.epub', '--polish'], TRANSLATE_FLAGS).flags).toEqual({ polish: true });
    expect(applyRunFlags(base, parseArgs(['--polish'], RUN_FLAGS).flags, selection).twoPass).toBe(true);
    expect(applyRunFlags(base, parseArgs(['--two-pass'], RUN_FLAGS).flags, selection).twoPass).toBe(true);
    expect(applyRunFlags({ ...base, twoPass: true }, {}, selection).twoPass).toBe(true);
  });

  test('validates export modes and language codes', () => {
    expect(parseExportMode(undefined)).toBe('bilingual');
    expect(parseExportMode('translation-only')).toBe('translation-only');
    expect(() => parseExportMode('side-by-side')).toThrow('Unknown --mode');
    expect(parseLanguage('pt-BR', '--to')).toBe('pt-BR');
    expect(() => parseLanguage('not a language', '--to')).toThrow('--to');
    expect(() => parseLanguage('', '--to')).toThrow('--to');
  });

  test('derives the default output path from the input or project file', () => {
    expect(defaultOutPath('books/dune.epub', 'vi')).toBe('books/dune.vi.epub');
    expect(defaultOutPath('books/dune.azw3.epubtrans', 'fr')).toBe('books/dune.fr.epub');
    expect(defaultOutPath('web-export.epubtrans', 'vi')).toBe('web-export.vi.epub');
  });
});
