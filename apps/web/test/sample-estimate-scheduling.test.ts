import { createDefaultSettings, type Project } from '@epubtrans/core';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESTIMATE_DEBOUNCE_MS } from '../src/lib/estimate-scheduler';
import { type SampleEstimateInput, useSampleEstimate } from '../src/lib/use-sample-estimate';

// Count the expensive core calls while keeping their real behaviour.
const calls = vi.hoisted(() => ({ select: 0, estimate: 0 }));
vi.mock('@epubtrans/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@epubtrans/core')>();
  return {
    ...core,
    selectSamplePassages: (...args: Parameters<typeof core.selectSamplePassages>) => {
      calls.select++;
      return core.selectSamplePassages(...args);
    },
    estimateSampleCost: (...args: Parameters<typeof core.estimateSampleCost>) => {
      calls.estimate++;
      return core.estimateSampleCost(...args);
    },
  };
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function makeProject(): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id: 'est',
    title: 'Book',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({ targetLang: 'vi', model: 'm' }),
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [1, 2, 3].map((c) => ({
      href: `ch${c}.xhtml`,
      title: `Chapter ${c}`,
      segments: [0, 1, 2].map((i) => ({ id: `c${c}-${i}`, sourceHtml: words(120), sourceText: words(120), status: 'pending' as const })),
    })),
  };
}

let root: Root;
let latest: ReturnType<typeof useSampleEstimate>;
function Probe(props: SampleEstimateInput) {
  latest = useSampleEstimate(props);
  return null;
}

beforeEach(async () => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  calls.select = 0;
  calls.estimate = 0;
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.getElementById('root') as unknown as Element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("the sample card's preview estimate", () => {
  const project = makeProject();
  const base: SampleEstimateInput = {
    project,
    version: 0,
    provider: { providerId: 'openai', baseURL: 'https://api.openai.com/v1', model: 'm' },
    stored: undefined,
    passages: 2,
    paused: false,
  };
  const render = (props: SampleEstimateInput) => act(async () => root.render(createElement(Probe, props)));
  const settle = () => act(async () => vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS + 50));

  it('collapses a burst of project changes into one recompute, run after the burst', async () => {
    await render(base);
    // 100 project changes (finished segments, keystrokes) 20 ms apart: always inside the debounce window.
    for (let version = 1; version <= 100; version++) {
      await render({ ...base, version });
      await act(async () => vi.advanceTimersByTime(20));
    }
    expect(calls.estimate).toBe(0);
    expect(latest).toBeUndefined();

    await settle();
    expect(calls).toEqual({ select: 1, estimate: 1 });
    expect(latest?.inputTokens).toBeGreaterThan(0);
  });

  it('keeps the last estimate while a run is in progress and refreshes it once the run ends', async () => {
    await render(base);
    await settle();
    expect(calls.estimate).toBe(1);

    for (let version = 1; version <= 20; version++) await render({ ...base, version, paused: true });
    await settle();
    expect(calls.estimate).toBe(1);
    expect(latest).toBeDefined();

    await render({ ...base, version: 21, paused: false });
    await settle();
    expect(calls.estimate).toBe(2);
  });
});
