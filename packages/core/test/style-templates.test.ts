import { describe, expect, it } from 'vitest';
import {
  ExportStyleError,
  exportStylePreset,
  MAX_STYLE_FILE_BYTES,
  MAX_TEMPLATES_PER_FILE,
  parseStyleFile,
  parseStyleTemplatesJson,
  serializeStyleTemplates,
  validateTemplateName,
} from '../src';

const file = (templates: unknown[]) => JSON.stringify({ format: 'epubtrans-style-templates', version: 1, templates });

describe('style template files', () => {
  it('round-trips templates', () => {
    const templates = [
      { name: 'Learner, teal', style: exportStylePreset('learner') },
      { name: 'Mine', style: { source: { color: '#333333', font: 'literata' as const } } },
    ];
    expect(parseStyleTemplatesJson(serializeStyleTemplates(templates))).toEqual({ templates, ignoredKeys: [] });
  });

  it('rejects files that are not template files, too large, or hold invalid templates', () => {
    expect(() => parseStyleTemplatesJson('{"source":{}}')).toThrow(/Not an epubtrans style template file/);
    expect(() => parseStyleTemplatesJson('not json')).toThrow(/not valid JSON/);
    expect(() => parseStyleTemplatesJson(JSON.stringify({ format: 'epubtrans-style-templates', version: 2, templates: [] }))).toThrow(/version/);
    expect(() => parseStyleTemplatesJson(' '.repeat(MAX_STYLE_FILE_BYTES + 1))).toThrow(/larger than/);
    const many = Array.from({ length: MAX_TEMPLATES_PER_FILE + 1 }, (_, i) => ({ name: `t${i}`, style: {} }));
    expect(() => parseStyleTemplatesJson(file(many))).toThrow(/more than/);
    expect(() => parseStyleTemplatesJson(file([{ name: 'x', style: { source: { color: '}' } } }]))).toThrow(ExportStyleError);
    expect(() => parseStyleTemplatesJson(file([{ name: '', style: {} }]))).toThrow(/name/);
  });

  it('drops keys a newer version may write, lists them, and still rejects invalid values', () => {
    const newer = JSON.stringify({
      format: 'epubtrans-style-templates',
      version: 1,
      exportedBy: 'epubtrans 9',
      templates: [{ name: 'x', tags: ['a'], style: { source: { color: '#ABC', shadow: '1px' }, pageMargins: 2 } }],
    });
    expect(parseStyleTemplatesJson(newer)).toEqual({
      templates: [{ name: 'x', style: { source: { color: '#aabbcc' } } }],
      ignoredKeys: ['exportedBy', 'templates[0].tags', 'templates[0].style.pageMargins', 'templates[0].style.source.shadow'],
    });
    expect(() => parseStyleTemplatesJson(file([{ name: 'x', style: { source: { color: 'red', shadow: 1 } } }]))).toThrow(/source\.color/);
  });

  it('accepts a UTF-8 byte order mark', () => {
    expect(parseStyleTemplatesJson(`\uFEFF${file([{ name: 'x', style: {} }])}`).templates).toEqual([{ name: 'x', style: {} }]);
  });

  it('validates template names', () => {
    expect(validateTemplateName('  Classic  ')).toBe('Classic');
    expect(() => validateTemplateName('a\u0007b')).toThrow(ExportStyleError);
    expect(() => validateTemplateName('x'.repeat(81))).toThrow(ExportStyleError);
    expect(() => validateTemplateName(42)).toThrow(ExportStyleError);
  });
});

describe('--style-file contents', () => {
  it('accepts a bare style or a file with exactly one template', () => {
    expect(parseStyleFile('{"source":{"color":"#ABC"}}')).toEqual({ style: { source: { color: '#aabbcc' } }, ignoredKeys: [] });
    expect(parseStyleFile(file([{ name: 'one', style: { blockSpacingEm: 1 } }]))).toEqual({ style: { blockSpacingEm: 1 }, ignoredKeys: [] });
    expect(() => parseStyleFile(file([]))).toThrow(/exactly one/);
    expect(() =>
      parseStyleFile(
        file([
          { name: 'a', style: {} },
          { name: 'b', style: {} },
        ]),
      ),
    ).toThrow(/exactly one/);
    expect(() => parseStyleFile('{"source":{"font":"url(x)"}}')).toThrow(ExportStyleError);
  });

  it('accepts a byte order mark and drops unknown keys, naming them', () => {
    expect(parseStyleFile('\uFEFF{"hint":{"color":"#000","glow":true},"future":1}')).toEqual({
      style: { hint: { color: '#000000' } },
      ignoredKeys: ['style.future', 'style.hint.glow'],
    });
    expect(() => parseStyleFile('{"future":1,"blockSpacingEm":9}')).toThrow(/blockSpacingEm/);
  });
});
