import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets } from '../src';

// Fake keys shaped like real ones; none of these is a credential.
const OPENAI = 'sk-proj-AbCdEf0123456789xyzXYZ';
const ANTHROPIC = 'sk-ant-api03-Zk9_fake-KEY0123456789abcdef';
const OPENROUTER = 'sk-or-v1-0123456789abcdef0123456789abcdef';
const GOOGLE = 'AIzaSyD-fake0123456789abcdefghijklmnop';

describe('redactSecrets: known key', () => {
  const key = 'custom-proxy-key-9f8e7d6c5b4a';

  it('removes the exact key wherever it appears', () => {
    const out = redactSecrets(`401: bad credentials ${key} for ${key}.`, [key]);
    expect(out).toBe(`401: bad credentials ${REDACTED} for ${REDACTED}.`);
  });

  it('removes a partial echo of at least 8 characters, including a masked head or tail', () => {
    expect(redactSecrets(`Incorrect API key provided: ${key.slice(0, 12)}****`, [key])).not.toContain(key.slice(0, 8));
    expect(redactSecrets(`...${key.slice(-10)}`, [key])).not.toContain(key.slice(-8));
    expect(redactSecrets(`middle ${key.slice(5, 20)} part`, [key])).toBe(`middle ${REDACTED} part`);
  });

  it('keeps shorter runs, which are ordinary text', () => {
    expect(redactSecrets(`only ${key.slice(0, 7)} here`, [key])).toBe(`only ${key.slice(0, 7)} here`);
  });

  it('removes URL-encoded and JSON-escaped echoes', () => {
    const odd = 'key/with+odd=chars"and\\more-0123';
    expect(redactSecrets(`url ?q=${encodeURIComponent(odd)}`, [odd])).not.toContain(encodeURIComponent(odd));
    expect(redactSecrets(`body ${JSON.stringify({ k: odd })}`, [odd])).not.toContain('odd=chars');
  });

  it('leaves text alone for an empty or tiny key instead of mangling it', () => {
    expect(redactSecrets('nothing to see', [''])).toBe('nothing to see');
    expect(redactSecrets('a key is here', ['k'])).toBe('a key is here');
  });
});

describe('redactSecrets: secret shapes', () => {
  it.each([
    ['OpenAI', OPENAI],
    ['Anthropic', ANTHROPIC],
    ['OpenRouter', OPENROUTER],
    ['Google', GOOGLE],
  ])('redacts a %s key without knowing it', (_name, secret) => {
    const out = redactSecrets(`Incorrect API key provided: ${secret}. Check your settings.`);
    expect(out).toBe(`Incorrect API key provided: ${REDACTED}. Check your settings.`);
  });

  it('redacts a Bearer header echo and keeps the scheme', () => {
    expect(redactSecrets('request headers: Authorization: Bearer abc123.def456_ghi789')).toBe(`request headers: Authorization: ${REDACTED}`);
    expect(redactSecrets('sent bearer Tkn0123456789abcdef to host')).toBe(`sent bearer ${REDACTED} to host`);
  });

  it('redacts key headers in dumps and JSON', () => {
    expect(redactSecrets('x-api-key: some-opaque-value-123')).toBe(`x-api-key: ${REDACTED}`);
    expect(redactSecrets('{"x-api-key":"some-opaque-value-123","accept":"*/*"}')).toBe(`{"x-api-key":"${REDACTED}","accept":"*/*"}`);
  });

  it('redacts key and token query parameters but keeps the rest of the URL', () => {
    const out = redactSecrets('GET https://proxy.example/v1/models?key=abcDEF123&alt=json&api_key=zzz999&access_token=t0k3n failed');
    expect(out).toBe(`GET https://proxy.example/v1/models?key=${REDACTED}&alt=json&api_key=${REDACTED}&access_token=${REDACTED} failed`);
  });

  it('redacts a long base64 or hex token after a key, token or secret word', () => {
    expect(redactSecrets('Invalid API key: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b')).toBe(`Invalid API key: ${REDACTED}`);
    expect(redactSecrets('the secret is dGhpcy1pcy1hLWxvbmctYmFzZTY0LXRva2Vu0123')).toBe(`the secret is ${REDACTED}`);
    expect(redactSecrets('token "AbCdEfGhIjKlMnOp0123456789=="')).toContain(REDACTED);
  });

  it('does not touch ordinary error text', () => {
    for (const text of [
      'HTTP 429 from api.openai.com: Rate limit reached for requests',
      'HTTP 400 from api.example.com: invalid x-api-key',
      'segment missing from answer',
      'model answer is not valid JSON: Unexpected token } in JSON at position 12',
      'The task-based key concept is described in monkey=banana',
      'Network error calling api.deepseek.com: fetch failed',
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});
