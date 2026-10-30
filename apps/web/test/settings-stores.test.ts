import { createDefaultSettings } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { createApiKeyStore } from '../src/lib/api-key-store';
import { createProviderConfigStore, parseProviderConfig, resolveActiveProvider, settingsForRun } from '../src/lib/provider-config-store';
import type { KeyValueStorage } from '../src/lib/safe-storage';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

class BrokenStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error('denied');
  }
  setItem(): void {
    throw new Error('quota');
  }
  removeItem(): void {
    throw new Error('denied');
  }
}

describe('api key store', () => {
  it('keeps keys in memory only unless remembered', () => {
    const storage = new MemoryStorage();
    const keys = createApiKeyStore(storage, ['openai', 'custom']);
    keys.setKey('openai', ' sk-test ', false);
    expect(keys.getKey('openai')).toBe('sk-test');
    expect(keys.isRemembered('openai')).toBe(false);
    expect(storage.data.size).toBe(0);
    expect(createApiKeyStore(storage, ['openai']).getKey('openai')).toBe('');
  });

  it('persists remembered keys and removes them when unchecked or cleared', () => {
    const storage = new MemoryStorage();
    const keys = createApiKeyStore(storage, ['openai']);
    keys.setKey('openai', 'sk-test', true);
    const reloaded = createApiKeyStore(storage, ['openai']);
    expect(reloaded.getKey('openai')).toBe('sk-test');
    expect(reloaded.isRemembered('openai')).toBe(true);

    reloaded.setKey('openai', 'sk-test', false);
    expect(storage.data.size).toBe(0);
    expect(reloaded.getKey('openai')).toBe('sk-test');

    reloaded.setKey('openai', 'sk-test', true);
    reloaded.clearKey('openai');
    expect(storage.data.size).toBe(0);
    expect(reloaded.getKey('openai')).toBe('');
  });

  it('reports when storage refuses to remember the key', () => {
    const keys = createApiKeyStore(new BrokenStorage(), ['openai']);
    expect(keys.setKey('openai', 'sk-test', true)).toBe(false);
    expect(keys.getKey('openai')).toBe('sk-test');
    expect(keys.isRemembered('openai')).toBe(false);
  });
});

describe('provider config', () => {
  it('rejects malformed or unknown persisted configuration', () => {
    expect(parseProviderConfig(null)).toBeUndefined();
    expect(parseProviderConfig({ providerId: 'nope' })).toBeUndefined();
    expect(parseProviderConfig({ providerId: 'openai', profiles: { openai: { model: 7, priceInPerM: -1 }, evil: { model: 'x' } } })).toEqual({
      providerId: 'openai',
      profiles: { openai: { baseURL: '', model: '' } },
    });
  });

  it('uses the preset base URL except for the custom preset', () => {
    const config = { providerId: 'openai', profiles: { openai: { baseURL: 'https://evil.example', model: ' gpt ' } } };
    expect(resolveActiveProvider(config)).toEqual({ providerId: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt' });
    const custom = { providerId: 'custom', profiles: { custom: { baseURL: ' https://mock.test/v1 ', model: 'm' } } };
    expect(resolveActiveProvider(custom).baseURL).toBe('https://mock.test/v1');
  });

  it('persists selection and profiles, dropping cleared prices', () => {
    const storage = new MemoryStorage();
    const store = createProviderConfigStore(storage);
    store.selectProvider('openrouter');
    store.updateProfile('openrouter', { model: 'a/b', priceInPerM: 1, priceOutPerM: 2 });
    store.updateProfile('openrouter', { model: 'c/d', priceInPerM: undefined, priceOutPerM: undefined });
    const reloaded = createProviderConfigStore(storage).store.get();
    expect(reloaded).toEqual({ providerId: 'openrouter', profiles: { openrouter: { baseURL: '', model: 'c/d' } } });
    expect(() => store.selectProvider('unknown')).toThrow();
  });

  it('merges the active provider into book settings for a run', () => {
    const settings = createDefaultSettings({ targetLang: 'fr', concurrency: 2 });
    const run = settingsForRun(settings, { providerId: 'custom', baseURL: 'https://mock.test/v1', model: 'm' });
    expect(run).toMatchObject({ targetLang: 'fr', concurrency: 2, providerId: 'custom', baseURL: 'https://mock.test/v1', model: 'm' });
  });
});
