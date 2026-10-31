import type { Page, Route } from '@playwright/test';
import { installMockPricing } from './mock-pricing';

/** Base URL of the fake OpenAI-compatible provider intercepted by page.route (never reaches the network). */
export const MOCK_BASE = 'https://mock-provider.test/v1';
export const MOCK_MODELS = ['mock-model', 'mock-model-pro'];

/** Answers of the guide requests: guideline sections, then the classified glossary entries. */
export const MOCK_GUIDE = {
  sections: {
    genre: '- Mock: satirical essay for adult readers.',
    address: '- Mock: narrator to reader: tôi – quý vị.',
  },
  glossary: [
    { term: 'Ireland', translation: 'Ai-len', type: 'place', note: 'country' },
    // Different types keep the generated order (place before term) independent of candidate counts.
    { term: 'shilling', translation: 'si-linh', type: 'term' },
  ],
};

export interface MockProviderState {
  /** Segment ids sent in each translate/review request, in arrival order. */
  segmentRequests: { kind: 'translate' | 'review'; ids: string[] }[];
  /** Style-guideline requests (one per generation). */
  guideRequests: number;
  /** Glossary-candidate classification requests (one per batch of candidates). */
  glossaryRequests: number;
  /** Lemmas sent in each Word Wise gloss request, in arrival order. */
  hintRequests: string[][];
  /** Prefix prepended to every translated segment. */
  prefix: string;
  /** Prefix each translation with the target language tag of its request instead (`[de] `), to see which language a tab used. */
  prefixByTarget: boolean;
  /** Artificial latency per chat request. */
  delayMs: number;
  /** Segment ids answered with markup that fails validation, so they end in `error`; clear it to answer validly again. */
  invalidIds: Set<string>;
  /** Answer every segment with invalid markup (e.g. all sampled passages fail while the rest of the book stays pending). */
  invalidAll: boolean;
}

/** The target language tag in a translation prompt ("Target language: German (de)"). */
const TARGET_TAG = /Target language: [^(\n]*\(([\w-]+)\)/;

/** Forbidden markup: the translation validator rejects it whatever the source looks like. */
const INVALID_MARKUP = '<script>broken()</script>';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

interface ChatBody {
  messages: { role: string; content: string }[];
}

function answer(body: ChatBody, state: MockProviderState): string {
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
  if (system.includes('terminology editor')) {
    state.glossaryRequests++;
    return JSON.stringify({ entries: MOCK_GUIDE.glossary });
  }
  if (system.includes('preparing a book translation')) {
    state.guideRequests++;
    return JSON.stringify({ sections: MOCK_GUIDE.sections });
  }
  if (system.includes('Word Wise hints')) {
    const { items } = JSON.parse(user) as { items: { id: string; lemma: string }[] };
    state.hintRequests.push(items.map((i) => i.lemma));
    return JSON.stringify({ items: items.map((i) => ({ id: i.id, sense: 'main', gloss: `≈${i.lemma}` })) });
  }
  const { segments } = JSON.parse(user) as { segments: { id: string; html?: string; draft?: string }[] };
  const review = segments.some((s) => s.draft !== undefined);
  const prefix = state.prefixByTarget ? `[${TARGET_TAG.exec(`${system}\n${user}`)?.[1] ?? '?'}] ` : state.prefix;
  state.segmentRequests.push({ kind: review ? 'review' : 'translate', ids: segments.map((s) => s.id) });
  return JSON.stringify({
    segments: segments.map((s) => ({
      id: s.id,
      html: review ? (s.draft ?? '') : state.invalidAll || state.invalidIds.has(s.id) ? INVALID_MARKUP : `${prefix}${s.html ?? ''}`,
    })),
  });
}

async function fulfill(route: Route, status: number, json?: unknown): Promise<void> {
  try {
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: json === undefined ? '' : JSON.stringify(json) });
  } catch {
    // The page navigated away (reload mid-translation): the request is gone.
  }
}

/** Installs the fake provider on `page`: GET /models, POST /chat/completions (translate, review, guideline, glossary, Word Wise glosses). */
export async function installMockProvider(
  page: Page,
  opts: Partial<Pick<MockProviderState, 'delayMs' | 'prefix' | 'prefixByTarget'>> = {},
): Promise<MockProviderState> {
  const state: MockProviderState = {
    segmentRequests: [],
    guideRequests: 0,
    glossaryRequests: 0,
    hintRequests: [],
    prefix: opts.prefix ?? '[vi] ',
    prefixByTarget: opts.prefixByTarget ?? false,
    delayMs: opts.delayMs ?? 0,
    invalidIds: new Set(),
    invalidAll: false,
  };
  await page.route(`${MOCK_BASE}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return fulfill(route, 204);
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/models')) return fulfill(route, 200, { data: MOCK_MODELS.map((id) => ({ id })) });
    if (request.method() === 'POST' && path.endsWith('/chat/completions')) {
      const content = answer(request.postDataJSON() as ChatBody, state);
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      return fulfill(route, 200, { choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 120, completion_tokens: 80 } });
    }
    return fulfill(route, 404, { error: { message: 'not found' } });
  });
  // The app also queries public price catalogs; serve fixtures so no test reaches the real network.
  await installMockPricing(page);
  return state;
}

export const translatedIds = (state: MockProviderState, from = 0): string[] =>
  state.segmentRequests.slice(from).flatMap((r) => (r.kind === 'translate' ? r.ids : []));
