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
    expect(parseStyleTemplatesJson(serializeStyleTemplates(templates))).toEqual(templates);
  });

  it('rejects files that are not template files, too large, or hold invalid templates', () => {
    expect(() => parseStyleTemplatesJson('{"source":{}}')).toThrow(/Not an epubtrans style template file/);
    expect(() => parseStyleTemplatesJson('not json')).toThrow(/not valid JSON/);
    expect(() => parseStyleTemplatesJson(JSON.stringify({ format: 'epubtrans-style-templates', version: 2, templates: [] }))).toThrow(/version/);
    expect(() => parseStyleTemplatesJson(' '.repeat(MAX_STYLE_FILE_BYTES + 1))).toThrow(/larger than/);
    const many = Array.from({ length: MAX_TEMPLATES_PER_FILE + 1 }, (_, i) => ({ name: `t${i}`, style: {} }));
    expect(() => parseStyleTemplatesJson(file(many))).toThrow(/more than/);
    expect(() => parseStyleTemplatesJson(file([{ name: 'x', style: { source: { color: '}' } } }]))).toThrow(ExportStyleError);
    expect(() => parseStyleTemplatesJson(file([{ name: 'x', style: {}, extra: 1 }]))).toThrow(/unknown key/);
    expect(() => parseStyleTemplatesJson(file([{ name: '', style: {} }]))).toThrow(/name/);
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
    expect(parseStyleFile('{"source":{"color":"#ABC"}}')).toEqual({ source: { color: '#aabbcc' } });
    expect(parseStyleFile(file([{ name: 'one', style: { blockSpacingEm: 1 } }]))).toEqual({ blockSpacingEm: 1 });
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
});
