import type { Page, Request, Route } from '@playwright/test';

/** The two public price hosts the app may query; fixtures replace them so tests never touch the network. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const LITELLM_PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** OpenRouter lists `maker/model` with USD per token as strings. */
export const MOCK_OPENROUTER_CATALOG = {
  data: [
    { id: 'mock-lab/mock-model-pro', pricing: { prompt: '0.000002', completion: '0.00001' } },
    { id: 'mock-lab/mock-model-pro:batch', pricing: { prompt: '0.000001', completion: '0.000005' } },
  ],
};

/** LiteLLM lists plain ids with USD per token as numbers. */
export const MOCK_LITELLM_CATALOG = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, litellm_provider: 'sample', mode: 'chat' },
  'mock-lite-only': { input_cost_per_token: 4e-7, output_cost_per_token: 1.6e-6, litellm_provider: 'custom', mode: 'chat' },
};

export interface MockPricingState {
  /** Every request that reached a price host, in arrival order. */
  requests: Request[];
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'accept, content-type' };

/** Serves both price catalogs from fixtures and records the requests so tests can inspect what was sent. */
export async function installMockPricing(page: Page): Promise<MockPricingState> {
  const state: MockPricingState = { requests: [] };
  const serve = (body: unknown) => async (route: Route) => {
    const request = route.request();
    state.requests.push(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS }).catch(() => undefined);
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  };
  await page.route(OPENROUTER_MODELS_URL, serve(MOCK_OPENROUTER_CATALOG));
  await page.route(LITELLM_PRICES_URL, serve(MOCK_LITELLM_CATALOG));
  return state;
}
