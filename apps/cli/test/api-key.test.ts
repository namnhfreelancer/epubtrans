import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireApiKey, resolveApiKey } from '../src/api-key';
import { UsageError } from '../src/args';

const stdin = async () => 'stdin-key\n';
const keyFile = (content: string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'epubtrans-key-')), 'key.txt');
  writeFileSync(path, content);
  return path;
};

describe('API key resolution', () => {
  test('--api-key-file beats EPUBTRANS_API_KEY, which beats the provider variable', async () => {
    const env = { EPUBTRANS_API_KEY: 'generic', OPENAI_API_KEY: 'provider' };
    expect(await resolveApiKey('openai', keyFile('from-file\n'), { env, readStdin: stdin })).toEqual({
      key: 'from-file',
      source: expect.stringContaining('file '),
    });
    expect(await resolveApiKey('openai', undefined, { env, readStdin: stdin })).toEqual({ key: 'generic', source: 'env EPUBTRANS_API_KEY' });
    expect(await resolveApiKey('openai', undefined, { env: { OPENAI_API_KEY: 'provider' }, readStdin: stdin })).toEqual({
      key: 'provider',
      source: 'env OPENAI_API_KEY',
    });
  });

  test('each preset reads its own provider variable and ignores the others', async () => {
    const env = { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'r', DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: 'o' };
    for (const [provider, key] of [
      ['anthropic', 'a'],
      ['gemini', 'g'],
      ['openrouter', 'r'],
      ['deepseek', 'd'],
      ['openai', 'o'],
    ] as const) {
      expect((await resolveApiKey(provider, undefined, { env, readStdin: stdin }))?.key).toBe(key);
    }
    expect(await resolveApiKey('custom', undefined, { env, readStdin: stdin })).toBeUndefined();
  });

  test('empty variables are skipped and "-" reads stdin', async () => {
    expect((await resolveApiKey('openai', undefined, { env: { EPUBTRANS_API_KEY: '  ', OPENAI_API_KEY: 'o' }, readStdin: stdin }))?.key).toBe('o');
    expect((await resolveApiKey('openai', '-', { env: {}, readStdin: stdin }))?.key).toBe('stdin-key');
  });

  test('rejects empty, multi-token and unreadable key files without echoing the key', async () => {
    await expect(resolveApiKey('openai', keyFile('  \n'), { env: {}, readStdin: stdin })).rejects.toThrow('is empty');
    const error = await resolveApiKey('openai', keyFile('sk-secret with-space'), { env: {}, readStdin: stdin }).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).not.toContain('sk-secret');
    await expect(resolveApiKey('openai', '/nonexistent/key', { env: {}, readStdin: stdin })).rejects.toThrow('Cannot read --api-key-file');
  });

  test('genericAllowed: false skips EPUBTRANS_API_KEY, uses the provider variable, and explains when only the generic key is set', async () => {
    const opts = { genericAllowed: false };
    expect((await resolveApiKey('deepseek', undefined, { env: { EPUBTRANS_API_KEY: 'g', DEEPSEEK_API_KEY: 'd' }, readStdin: stdin }, opts))?.key).toBe('d');
    expect((await resolveApiKey('deepseek', keyFile('f\n'), { env: { EPUBTRANS_API_KEY: 'g' }, readStdin: stdin }, opts))?.key).toBe('f');
    expect(await resolveApiKey('deepseek', undefined, { env: {}, readStdin: stdin }, opts)).toBeUndefined();
    const error = await requireApiKey('deepseek', undefined, { env: { EPUBTRANS_API_KEY: 'g' }, readStdin: stdin }, opts).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('DEEPSEEK_API_KEY');
    expect((error as Error).message).toContain('--provider deepseek');
    const missing = await requireApiKey('deepseek', undefined, { env: {}, readStdin: stdin }, opts).catch((e: unknown) => e as Error);
    expect((missing as Error).message).toContain('DEEPSEEK_API_KEY');
    expect((missing as Error).message).not.toContain('EPUBTRANS_API_KEY');
  });

  test('requireApiKey explains how to configure a missing key', async () => {
    const error = await requireApiKey('gemini', undefined, { env: {}, readStdin: stdin }).catch((e: unknown) => e as Error);
    expect((error as Error).message).toContain('EPUBTRANS_API_KEY');
    expect((error as Error).message).toContain('GEMINI_API_KEY');
  });
});
