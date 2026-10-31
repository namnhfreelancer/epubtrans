import { getProviderPreset, PROVIDER_PRESETS, REASONING_LEVELS } from '@epubtrans/core';
import { buildProvider, providerConfig } from '../lib/provider-config-store';
import { currentProviderState } from '../lib/use-active-provider';
import { englishMessage, providerFailure } from './tool-context';
import { CANCELLED, objectSchema, type ToolSpec } from './tool-definition';
import { clip, fail, fitList, ok, untrustedText } from './tool-result';

const MAX_MODELS = 60;

/** Provider tools: pick the preset and model, list models. API keys and the custom endpoint stay user-only. */
export function providerTools(): ToolSpec[] {
  return [
    {
      name: 'configure_provider',
      title: 'Choose provider and model',
      description:
        'Selects the AI provider preset used for translation and, optionally, the model id and the reasoning setting for reasoning models (default, low or off; an endpoint that rejects it is asked again without it). Reports whether the user has stored an API key for it and whether translation can start. API keys and the custom endpoint URL are set by the user in Settings only.',
      inputSchema: objectSchema(
        {
          providerId: { type: 'string', enum: PROVIDER_PRESETS.map((p) => p.id), description: 'Provider preset id.' },
          model: { type: 'string', description: 'Model id as listed by list_models, e.g. gpt-5-mini.', maxLength: 200 },
          reasoning: {
            type: 'string',
            enum: [...REASONING_LEVELS],
            description: 'Reasoning effort for reasoning models: default (provider default), low or off. Saved for this provider.',
          },
        },
        ['providerId'],
      ),
      annotations: {},
      run: async (args) => {
        const preset = getProviderPreset(args.string('providerId'));
        const model = args.optString('model');
        const reasoning = REASONING_LEVELS.find((level) => level === args.optString('reasoning'));
        providerConfig.selectProvider(preset.id);
        // A typed model id drops the provider-published price of the previous model, like editing the field in Settings.
        if (model !== undefined) providerConfig.updateProfile(preset.id, { model, priceInPerM: undefined, priceOutPerM: undefined });
        if (reasoning !== undefined) providerConfig.updateProfile(preset.id, { reasoning });
        const state = currentProviderState();
        return ok({
          providerId: state.active.providerId,
          provider: preset.label,
          model: clip(state.active.model, 200),
          reasoning: state.active.reasoning ?? 'default',
          keyPresent: state.apiKey !== '',
          ready: !state.problem,
          ...(state.problem ? { problem: englishMessage(state.problem) } : {}),
        });
      },
    },
    {
      name: 'list_models',
      title: 'List models',
      description:
        'Lists the model ids offered by the selected provider (up to 60), optionally filtered by a case-insensitive substring. Model ids come from the provider. Pick one with configure_provider.',
      inputSchema: objectSchema({ filter: { type: 'string', description: 'Case-insensitive substring to keep, e.g. mini or claude.', maxLength: 100 } }),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      run: async (args, signal) => {
        const state = currentProviderState();
        // A model is not needed to list models; only a key (or the custom endpoint) is.
        const blocking = state.problem === 'run.needModel' ? undefined : providerFailure(state);
        if (blocking) return blocking;
        let ids: string[];
        try {
          const provider = buildProvider(state.active, state.apiKey);
          ids = provider.listModelInfo ? (await provider.listModelInfo(signal)).map((m) => m.id) : await provider.listModels(signal);
        } catch (err) {
          if (signal?.aborted) return CANCELLED();
          return fail(`The provider could not list models: ${untrustedText(err instanceof Error ? err.message : String(err), 300)}`);
        }
        const filter = args.optString('filter')?.toLowerCase();
        const matching = filter ? ids.filter((id) => id.toLowerCase().includes(filter)) : ids;
        const shown = matching.slice(0, MAX_MODELS).map((id) => untrustedText(id, 100));
        return fitList(shown, (models) =>
          ok({
            providerId: state.active.providerId,
            total: matching.length,
            models,
            ...(matching.length > MAX_MODELS ? { note: `Showing ${MAX_MODELS} of ${matching.length}; pass a filter to narrow.` } : {}),
          }),
        );
      },
    },
  ];
}
