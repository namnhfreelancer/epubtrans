import type { Project } from '@epubtrans/core';
import { useActiveProvider } from '../../lib/use-active-provider';
import { useModelPricing } from '../../lib/use-model-pricing';
import { CostEstimateCard } from './cost-estimate-card';
import { GuidelineCard } from './guideline-card';
import { LanguageOptionsCard } from './language-options-card';
import { SampleTranslationCard } from './sample-translation-card';
import { TranslationControls } from './translation-controls';

export function TranslationSetupPanel({ project, version }: { project: Project; version: number }) {
  const provider = useActiveProvider();
  // One price lookup feeds both the estimate and the cost of the tokens a run used.
  const lookup = useModelPricing(provider.active.model, provider.active.providerId);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <LanguageOptionsCard project={project} active={provider.active} />
        <GuidelineCard project={project} provider={provider} />
        <SampleTranslationCard project={project} version={version} provider={provider} />
      </div>
      <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <TranslationControls project={project} version={version} provider={provider} lookup={lookup} />
        <CostEstimateCard project={project} version={version} active={provider.active} lookup={lookup} />
      </div>
    </div>
  );
}
