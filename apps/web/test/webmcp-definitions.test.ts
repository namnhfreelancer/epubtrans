import 'fake-indexeddb/auto';
import { EXPORT_MODES } from '@epubtrans/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModelContext, registerWebMcpTools } from '../src/webmcp/model-context-adapter';
import { validateInput } from '../src/webmcp/tool-input';
import { fitList, htmlToText, MAX_OUTPUT_CHARS, ok, serializeResult } from '../src/webmcp/tool-result';
import { fakeFetch, fakeModelContext, newProviderState, SENTINEL_KEY, toolHarness } from './webmcp-test-support';

const EXPECTED_TOOLS = [
  'list_books',
  'import_book_from_url',
  'delete_book',
  'get_book_status',
  'update_book_settings',
  'configure_provider',
  'list_models',
  'generate_guide',
  'translate_sample',
  'start_translation',
  'pause_translation',
  'list_errors',
  'retranslate_segment',
  'export_epub',
];

function definitions() {
  const harness = toolHarness({ fetch: fakeFetch(newProviderState()) });
  const tools = [...harness.tools.values()];
  harness.unregister();
  return tools;
}

describe('WebMCP tool definitions', () => {
  it('registers the 14 v1 tools, without edit_segment', () => {
    expect(definitions().map((t) => t.name)).toEqual(EXPECTED_TOOLS);
  });

  it('stay within the agent budgets and the spec name rule', () => {
    for (const tool of definitions()) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,30}$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(500);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
        expect(name.length).toBeLessThanOrEqual(30);
        expect(prop.description.length, `${tool.name}.${name}`).toBeLessThanOrEqual(150);
      }
      for (const name of tool.inputSchema.required) expect(tool.inputSchema.properties[name], `${tool.name} requires ${name}`).toBeDefined();
      // Schemas must survive structured serialization.
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(tool.inputSchema);
    }
  });

  it('annotate reads, spending/deleting and untrusted content', () => {
    const byName = new Map(definitions().map((t) => [t.name, t.annotations]));
    for (const name of ['start_translation', 'delete_book']) expect(byName.get(name)?.consequentialHint, name).toBe(true);
    for (const name of ['list_books', 'get_book_status', 'list_models', 'list_errors']) expect(byName.get(name)?.readOnlyHint, name).toBe(true);
    for (const name of ['list_books', 'get_book_status', 'list_models', 'generate_guide', 'translate_sample', 'list_errors', 'retranslate_segment']) {
      expect(byName.get(name)?.untrustedContentHint, name).toBe(true);
    }
    // No tool takes or sets a key or a base URL.
    for (const tool of definitions()) for (const name of Object.keys(tool.inputSchema.properties)) expect(name).not.toMatch(/key|secret|base|endpoint/i);
  });

  it('describes twoPass as the polish-for-natural-style pass', () => {
    const settingsTool = definitions().find((t) => t.name === 'update_book_settings');
    const twoPass = settingsTool?.inputSchema.properties.twoPass;
    expect(twoPass?.type).toBe('boolean');
    expect(twoPass?.description).toMatch(/^Polish for natural style: .*native editor.*twice the cost; recommended for literature/);
    expect(settingsTool?.description).toContain('the polish pass (twoPass)');
  });

  it('derives the export modes from core, so new modes appear automatically', () => {
    const exportTool = definitions().find((t) => t.name === 'export_epub');
    const mode = exportTool?.inputSchema.properties.mode;
    expect(mode?.type === 'string' && mode.enum).toEqual(EXPORT_MODES);
  });
});

describe('the model context adapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is a no-op without document.modelContext', () => {
    expect(getModelContext(undefined)).toBeUndefined();
    expect(getModelContext({})).toBeUndefined();
    expect(getModelContext({ modelContext: {} })).toBeUndefined();
    expect(() => registerWebMcpTools(definitions(), undefined)()).not.toThrow();
  });

  it('detects a context with registerTool', () => {
    const { context } = fakeModelContext();
    expect(getModelContext({ modelContext: context })).toBe(context);
  });

  it('registers with one AbortSignal and unregisters everything on cleanup', async () => {
    const { context, tools } = fakeModelContext();
    const spy = vi.spyOn(context, 'registerTool');
    const stop = registerWebMcpTools(definitions(), context);
    expect(tools.size).toBe(14);
    const signals = new Set(spy.mock.calls.map(([, options]) => options?.signal));
    expect(signals.size).toBe(1);
    expect(spy.mock.calls.every(([, options]) => options && !('exposedTo' in options))).toBe(true);
    stop();
    expect(tools.size).toBe(0);
  });

  it('logs a failed registration once and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { registerTool: vi.fn(() => Promise.reject(new DOMException('dup', 'InvalidStateError'))) };
    registerWebMcpTools(definitions(), context);
    await new Promise((r) => setTimeout(r, 0));
    expect(context.registerTool).toHaveBeenCalledTimes(14);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('tool results', () => {
  it('redacts secrets in every string and always returns valid JSON', () => {
    const out = serializeResult(ok({ a: `x ${SENTINEL_KEY} y`, b: 'k"ey-with-quote1', c: [`pre ${SENTINEL_KEY.slice(0, 12)}`] }), [
      SENTINEL_KEY,
      'k"ey-with-quote1',
    ]);
    expect(out).not.toContain(SENTINEL_KEY);
    expect(out).not.toContain('ey-with-quote1');
    expect(out).not.toContain(SENTINEL_KEY.slice(0, 12));
    expect(JSON.parse(out)).toMatchObject({ ok: true, a: 'x [redacted] y', b: '[redacted]' });
  });

  it('cuts oversized output to valid JSON within 1500 characters', () => {
    const out = serializeResult(ok({ text: 'é"\\'.repeat(2000) }), []);
    expect(out.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(JSON.parse(out)).toMatchObject({ ok: true, truncated: true });
  });

  it('shortens lists to fit and says so', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'x'.repeat(40) }));
    const result = fitList(items, (shown) => ok({ items: shown }));
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(result.truncated).toBe(true);
    expect((result.items as unknown[]).length).toBeGreaterThan(5);
  });

  it('turns markup into plain text', () => {
    expect(htmlToText('<b>Fish</b> &amp; <i>chips</i>&#33; &lt;tag&gt; &#x41;')).toBe('Fish & chips! <tag> A');
  });
});

describe('input validation', () => {
  const schema = {
    type: 'object' as const,
    additionalProperties: false as const,
    required: ['id'],
    properties: {
      id: { type: 'string' as const, description: 'id', maxLength: 5 },
      mode: { type: 'string' as const, description: 'mode', enum: ['a', 'b'] },
      n: { type: 'integer' as const, description: 'n', minimum: 1, maximum: 3 },
      flag: { type: 'boolean' as const, description: 'flag' },
    },
  };

  it('accepts valid input, including a JSON string', () => {
    const args = validateInput(schema, '{"id":" ab ","mode":"b","n":2,"flag":false}');
    expect([args.string('id'), args.optString('mode'), args.optInt('n'), args.optBool('flag')]).toEqual(['ab', 'b', 2, false]);
  });

  it.each([
    [null, /required/],
    ['not json', /JSON object/],
    [[], /JSON object/],
    [{ id: 'a', extra: 1 }, /Unknown property "extra"/],
    [{ id: 3 }, /must be a string/],
    [{ id: '' }, /must not be empty/],
    [{ id: 'toolong' }, /longer than 5/],
    [{ id: 'a', mode: 'c' }, /one of: a, b/],
    [{ id: 'a', n: 1.5 }, /integer/],
    [{ id: 'a', n: 9 }, /between 1 and 3/],
    [{ id: 'a', flag: 'yes' }, /true or false/],
    [{ id: 'a\u0007' }, /control characters/],
  ])('rejects %j', (input, message) => {
    expect(() => validateInput(schema, input)).toThrow(message);
  });
});
