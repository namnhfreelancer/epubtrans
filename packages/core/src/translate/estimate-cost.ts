import type { CostEstimate, Project, ProjectSettings } from '../types';
import { buildReviewSystemPrompt, buildTranslateSystemPrompt, buildTranslateUserMessage } from './prompt-protocol';
import { estimateTokens } from './token-estimate';
import { makeBatches } from './translate-project';

/** Translations are usually somewhat longer in tokens than their source. */
const OUTPUT_RATIO = 1.3;
/** JSON envelope per segment in the answer (`{"id":"c1-2","html":""}`). */
const ANSWER_OVERHEAD = 12;

/**
 * Estimates tokens (and USD when both prices are set) for the remaining work of `translateProject`:
 * the translate pass over 'pending'/'error' segments plus, with `twoPass`, the review pass.
 */
export function estimateCost(project: Project, settings: ProjectSettings): CostEstimate {
  const translateSystem = estimateTokens(buildTranslateSystemPrompt(settings));
  const reviewSystem = estimateTokens(buildReviewSystemPrompt(settings));
  let inputTokens = 0;
  let outputTokens = 0;
  for (const chapter of project.chapters) {
    const todo = chapter.segments.filter((s) => s.status === 'pending' || s.status === 'error');
    for (const batch of makeBatches(todo)) {
      inputTokens += translateSystem + estimateTokens(buildTranslateUserMessage(batch));
      outputTokens += batch.reduce((n, s) => n + Math.ceil(estimateTokens(s.sourceHtml) * OUTPUT_RATIO) + ANSWER_OVERHEAD, 0);
    }
    if (!settings.twoPass) continue;
    const review = chapter.segments.filter((s) => s.status !== 'reviewed');
    for (const batch of makeBatches(review)) {
      const draft = batch.reduce((n, s) => n + Math.ceil(estimateTokens(s.translationHtml ?? s.sourceHtml) * (s.translationHtml ? 1 : OUTPUT_RATIO)), 0);
      const source = batch.reduce((n, s) => n + estimateTokens(s.sourceHtml) + ANSWER_OVERHEAD, 0);
      inputTokens += reviewSystem + source + draft;
      outputTokens += draft + batch.length * ANSWER_OVERHEAD;
    }
  }
  const { priceInPerM: pin, priceOutPerM: pout } = settings;
  const priced = typeof pin === 'number' && typeof pout === 'number' && pin >= 0 && pout >= 0;
  return {
    inputTokens,
    outputTokens,
    ...(priced ? { usd: Math.round(((inputTokens * pin + outputTokens * pout) / 1e6) * 10000) / 10000 } : {}),
  };
}
