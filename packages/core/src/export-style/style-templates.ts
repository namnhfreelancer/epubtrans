import type { ExportStyle, StyleTemplate } from '../types';
import { ExportStyleError, validateExportStyle } from './export-style-validation';

/**
 * Style template files: `{"format": "epubtrans-style-templates", "version": 1, "templates": [{"name", "style"}]}`.
 * Written by the web app's template export, read by its import and by the CLI's `--style-file` (which also accepts a
 * bare style object). Everything is validated with {@link validateExportStyle}; size and counts are bounded.
 */
export const STYLE_TEMPLATE_FORMAT = 'epubtrans-style-templates';
export const STYLE_TEMPLATE_VERSION = 1;
/** Largest style or template file accepted (bytes of JSON text). */
export const MAX_STYLE_FILE_BYTES = 64 * 1024;
export const MAX_TEMPLATES_PER_FILE = 100;
export const MAX_TEMPLATE_NAME_LENGTH = 80;

/** A template name: trimmed, 1–80 characters, no control characters. */
export function validateTemplateName(input: unknown, path = 'name'): string {
  const name = typeof input === 'string' ? input.trim() : '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (!name || name.length > MAX_TEMPLATE_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ExportStyleError(`Invalid style template: ${path} must be 1–${MAX_TEMPLATE_NAME_LENGTH} characters without control characters`);
  }
  return name;
}

export function validateStyleTemplate(input: unknown, path = 'template'): StyleTemplate {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ExportStyleError(`Invalid style template: ${path} must be an object`);
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o))
    if (key !== 'name' && key !== 'style') throw new ExportStyleError(`Invalid style template: unknown key ${path}.${key.slice(0, 40)}`);
  return { name: validateTemplateName(o.name, `${path}.name`), style: validateExportStyle(o.style, `${path}.style`) };
}

function parseJson(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_STYLE_FILE_BYTES) throw new ExportStyleError(`Style file is larger than ${MAX_STYLE_FILE_BYTES / 1024} KB`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ExportStyleError('Style file is not valid JSON');
  }
}

function templatesOf(value: Record<string, unknown>): StyleTemplate[] {
  if (value.version !== STYLE_TEMPLATE_VERSION) throw new ExportStyleError(`Unsupported style template version: ${String(value.version).slice(0, 20)}`);
  const list = value.templates;
  if (!Array.isArray(list)) throw new ExportStyleError('Invalid style template file: templates must be an array');
  if (list.length > MAX_TEMPLATES_PER_FILE) throw new ExportStyleError(`Style template file holds more than ${MAX_TEMPLATES_PER_FILE} templates`);
  return list.map((t, i) => validateStyleTemplate(t, `templates[${i}]`));
}

const isTemplateFile = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Record<string, unknown>).format === STYLE_TEMPLATE_FORMAT;

/** Reads a template file (web import). Throws {@link ExportStyleError} on anything invalid. */
export function parseStyleTemplatesJson(text: string): StyleTemplate[] {
  const value = parseJson(text);
  if (!isTemplateFile(value)) throw new ExportStyleError(`Not an epubtrans style template file (expected "format": "${STYLE_TEMPLATE_FORMAT}")`);
  return templatesOf(value);
}

/** Writes a template file for the given templates (pretty-printed). */
export function serializeStyleTemplates(templates: readonly StyleTemplate[]): string {
  const clean = templates.map((t) => validateStyleTemplate(t));
  return `${JSON.stringify({ format: STYLE_TEMPLATE_FORMAT, version: STYLE_TEMPLATE_VERSION, templates: clean }, null, 2)}\n`;
}

/**
 * Reads a CLI `--style-file`: a bare style object, or a template file holding exactly one template. Throws
 * {@link ExportStyleError} on anything invalid or ambiguous.
 */
export function parseStyleFile(text: string): ExportStyle {
  const value = parseJson(text);
  if (!isTemplateFile(value)) return validateExportStyle(value);
  const templates = templatesOf(value);
  if (templates.length !== 1) {
    throw new ExportStyleError(`The style file holds ${templates.length} templates; it must hold exactly one (export a single template from the web app)`);
  }
  return (templates[0] as StyleTemplate).style;
}
