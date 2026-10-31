import {
  DEFAULT_GLOSSARY_CAP,
  DEFAULT_SAMPLE_PASSAGES,
  estimateSampleCost,
  getProviderPreset,
  MAX_SAMPLE_PASSAGES,
  type Project,
  randomSampleSeed,
  type Segment,
} from '@epubtrans/core';
import { refreshJobLocks } from '../lib/cross-tab-job-lock';
import { dialogText, formatNumber, formatUsd } from '../lib/format';
import { cancelGuideJob, runGuideJob } from '../lib/guide-jobs';
import { settingsForRun } from '../lib/provider-config-store';
import { cancelSampleJob, type SampleRequest, startSampleJob, waitForSampleJob } from '../lib/sample-jobs';
import { countSegments, remainingWork } from '../lib/segment-counts';
import { startTranslation } from '../lib/start-translation';
import { getJobState, isJobActive, pauseJob } from '../lib/translation-jobs';
import { type ActiveProviderState, currentProviderState } from '../lib/use-active-provider';
import {
  busyFailure,
  busyReason,
  englishMessage,
  estimateRemaining,
  findBook,
  isFailure,
  providerFailure,
  resolveAgentPrices,
  roundUsd,
  type ToolContext,
} from './tool-context';
import { BOOK_ID, CANCELLED, objectSchema, type ToolSpec } from './tool-definition';
import { clip, fail, fitList, ok, untrustedText } from './tool-result';

const PREVIEW_SEGMENTS = 3;
const MAX_LISTED_IDS = 10;

const SETTINGS_CHANGED = 'settings changed after confirmation — call start_translation again';

/** Everything a full run's cost and destination depend on, as shown in (or implied by) the start confirmation. */
interface RunTerms {
  providerId: string;
  baseURL: string;
  model: string;
  /** Compared, never returned: a replaced key would bill another account than the one the user approved. */
  apiKey: string;
  twoPass: boolean;
  remaining: number;
}

function runTerms(project: Project, provider: ActiveProviderState): RunTerms {
  const { providerId, baseURL, model } = provider.active;
  const { twoPass } = project.settings;
  return { providerId, baseURL, model, apiKey: provider.apiKey, twoPass, remaining: remainingWork(countSegments(project), twoPass) };
}

const sameRunTerms = (a: RunTerms, b: RunTerms): boolean => (Object.keys(a) as (keyof RunTerms)[]).every((key) => a[key] === b[key]);

function segmentsById(project: Project, ids: readonly string[]): Segment[] {
  const wanted = new Set(ids);
  return project.chapters.flatMap((c) => c.segments.filter((s) => wanted.has(s.id)));
}

/** Translation tools: guide generation, sample, full run (with the user's approval), pause. */
export function translationTools(ctx: ToolContext): ToolSpec[] {
  return [
    {
      name: 'generate_guide',
      title: 'Generate guideline and glossary',
      description:
        'Drafts a book-specific style guideline and glossary with the configured model and saves them to the book (a few small paid requests). The current base guideline and existing glossary entries are kept. Waits until done and returns the glossary size and a few entries.',
      inputSchema: objectSchema(
        {
          bookId: BOOK_ID,
          maxEntries: { type: 'integer', minimum: 30, maximum: DEFAULT_GLOSSARY_CAP, description: `Glossary size limit (default ${DEFAULT_GLOSSARY_CAP}).` },
        },
        ['bookId'],
      ),
      annotations: { untrustedContentHint: true },
      run: async (args, signal) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const provider = currentProviderState();
        const notReady = providerFailure(provider);
        if (notReady) return notReady;
        const busy = await busyReason(project.id);
        if (busy) return busyFailure(busy);
        ctx.navigate({ name: 'book', id: project.id, tab: 'setup' });
        const onAbort = () => cancelGuideJob(project.id);
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          const result = await runGuideJob(project, () => provider.prepare(project), args.optInt('maxEntries') ?? DEFAULT_GLOSSARY_CAP);
          if (result.kind === 'cancelled') return CANCELLED();
          if (result.kind === 'error') return fail(`Generation failed: ${untrustedText(result.message, 300)}`);
          const { guide } = result;
          return ok({
            guidelineChars: guide.guideline.length,
            glossaryEntries: guide.glossary.length,
            candidates: guide.candidates,
            skippedBatches: guide.skippedBatches,
            sample: guide.glossary.slice(0, 8).map((e) => `${untrustedText(e.term, 40)} → ${untrustedText(e.translation, 40)}`),
          });
        } finally {
          signal?.removeEventListener('abort', onAbort);
        }
      },
    },
    {
      name: 'translate_sample',
      title: 'Translate a sample',
      description: `Translates a few passages from different chapters (a small paid run) to judge quality before the full run, and waits for it. Without passages it repeats the last sample, or picks ${DEFAULT_SAMPLE_PASSAGES} new ones; with passages it picks that many new ones. Segments the user edited by hand are kept as they are. Returns token usage, its cost, how many segments failed or were kept, and a short preview.`,
      inputSchema: objectSchema(
        { bookId: BOOK_ID, passages: { type: 'integer', minimum: 1, maximum: MAX_SAMPLE_PASSAGES, description: 'Number of new passages to pick.' } },
        ['bookId'],
      ),
      annotations: { untrustedContentHint: true },
      run: async (args, signal) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const provider = currentProviderState();
        const notReady = providerFailure(provider);
        if (notReady) return notReady;
        const busy = await busyReason(project.id);
        if (busy) return busyFailure(busy);
        const passages = args.optInt('passages');
        const request: SampleRequest =
          passages === undefined && project.lastSample
            ? { selection: project.lastSample }
            : { passages: passages ?? DEFAULT_SAMPLE_PASSAGES, seed: randomSampleSeed() };
        ctx.navigate({ name: 'book', id: project.id, tab: 'setup' });
        let started: Awaited<ReturnType<typeof startSampleJob>>;
        try {
          const { provider: chat, settings } = provider.prepare(project);
          started = await startSampleJob(project, settings, chat, request);
        } catch (err) {
          return fail(clip(err instanceof Error ? err.message : String(err), 300));
        }
        if (started === 'busy-elsewhere') {
          await refreshJobLocks();
          return busyFailure('busy-elsewhere');
        }
        if (started === 'already-running') return busyFailure((await busyReason(project.id)) ?? 'sample-running');
        const onAbort = () => cancelSampleJob(project.id);
        signal?.addEventListener('abort', onAbort, { once: true });
        const final = await waitForSampleJob(project.id).finally(() => signal?.removeEventListener('abort', onAbort));
        if (final.status === 'cancelled') return CANCELLED();
        if (final.status === 'failed')
          return fail(
            final.error ? `The sample failed: ${untrustedText(final.error, 300)}` : `Every sampled segment failed (${final.failed.length}).`,
            final.error ? undefined : 'Check the provider and model in Settings, then try again.',
          );
        const selection = project.lastSample;
        const { priceInPerM, priceOutPerM } = await resolveAgentPrices(project, provider, signal);
        const runSettings = { ...settingsForRun(project.settings, provider.active), priceInPerM, priceOutPerM };
        const cost = selection ? estimateSampleCost(project, runSettings, selection).usd : undefined;
        const preview = segmentsById(project, selection?.passages.flatMap((p) => p.segmentIds) ?? [])
          .slice(0, PREVIEW_SEGMENTS)
          .map((s) => ({ id: s.id, status: s.status, source: untrustedText(s.sourceHtml, 150), translation: untrustedText(s.translationHtml, 150) }));
        // Long segments could push the preview past the output budget; fitList drops trailing preview items instead.
        return fitList(preview, (shown) =>
          ok({
            done: final.done,
            total: final.total,
            usage: final.usage,
            estimatedUsd: roundUsd(cost),
            failed: final.failed.length,
            keptEdited: final.keptEdited.length,
            ...(final.failed.length > 0 ? { failedIds: final.failed.slice(0, MAX_LISTED_IDS) } : {}),
            preview: shown,
          }),
        );
      },
    },
    {
      name: 'start_translation',
      title: 'Start the full translation',
      description:
        'Starts or resumes the full paid translation of a book with the configured provider and model. The user sees the cost estimate and must approve it in the page. If the provider, model, two-pass mode or remaining work changes before the run starts, nothing starts and the call must be repeated. Returns at once; poll get_book_status for progress.',
      inputSchema: objectSchema({ bookId: BOOK_ID }, ['bookId']),
      annotations: { consequentialHint: true },
      run: async (args, signal) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const provider = currentProviderState();
        if (provider.problem) return ok({ started: false, reason: 'provider-not-ready', problem: englishMessage(provider.problem) });
        const busy = await busyReason(project.id);
        if (busy) return ok({ started: false, reason: busy === 'job-running' ? 'already-running' : busy });
        const remaining = remainingWork(countSegments(project), project.settings.twoPass);
        if (remaining === 0) return ok({ started: false, reason: 'nothing-to-translate' });
        // What the user is asked to approve; the run starts only if this is still what would run after the dialog.
        const confirmed = runTerms(project, provider);
        // Estimated from a frozen copy of the settings taken with `confirmed`: a settings change during the price
        // lookup must not alter the cost shown, so the approved cost is the cost of what would start.
        const estimate = await estimateRemaining({ ...project, settings: { ...project.settings } }, provider, signal);
        if (signal?.aborted) return CANCELLED();
        ctx.navigate({ name: 'book', id: project.id, tab: 'setup' });
        const { t } = ctx;
        const locale = ctx.locale();
        const prices = estimate.pricesPerM && {
          input: formatUsd(estimate.pricesPerM.input, locale),
          output: formatUsd(estimate.pricesPerM.output, locale),
        };
        const question = t('webmcp.startConfirm', {
          title: dialogText(project.title, 120),
          provider: getProviderPreset(provider.active.providerId).label,
          model: dialogText(provider.active.model, 100),
          segments: formatNumber(remaining, locale),
          cost: estimate.usd === null ? t('webmcp.costUnknown') : formatUsd(estimate.usd, locale),
          input: formatNumber(estimate.inputTokens, locale),
          output: formatNumber(estimate.outputTokens, locale),
          prices: prices ? t(estimate.priceSource === 'book-settings' ? 'webmcp.pricesFromBook' : 'webmcp.pricesLookedUp', prices) : '',
        });
        if (!ctx.confirm(t('webmcp.agentAsks', { question }))) return ok({ started: false, reason: 'declined', estimate });
        // A sample or run may have started (here or in another tab) while the dialog was open.
        const busyAfter = await busyReason(project.id);
        if (busyAfter) return ok({ started: false, reason: busyAfter === 'job-running' ? 'already-running' : busyAfter });
        // Other tool calls, or a Settings tab, may have changed the provider, model, key, two-pass mode or the book
        // while the estimate loaded or the dialog was open: never bill something other than what the user approved.
        const latest = await findBook(project.id);
        if (isFailure(latest)) return latest;
        if (!sameRunTerms(confirmed, runTerms(latest, currentProviderState()))) {
          return Object.assign(fail('The provider, model, API key, two-pass mode or remaining work changed after the user confirmed; nothing was started.'), {
            started: false,
            reason: SETTINGS_CHANGED,
          });
        }
        // Started with the confirmed provider snapshot; the job lock decides if another tab won meanwhile.
        const outcome = await startTranslation(latest, provider, t);
        if (outcome.kind === 'started') return ok({ started: true, remaining, estimate, next: 'Poll get_book_status for progress.' });
        if (outcome.kind === 'problem') return ok({ started: false, reason: 'provider-not-ready', problem: englishMessage(outcome.problem) });
        if (outcome.kind === 'error') return fail(`Could not start: ${clip(outcome.message, 300)}`);
        return ok({ started: false, reason: outcome.kind });
      },
    },
    {
      name: 'pause_translation',
      title: 'Pause the translation',
      description: 'Pauses the running translation of a book. Finished segments are saved, so start_translation resumes where it stopped.',
      inputSchema: objectSchema({ bookId: BOOK_ID }, ['bookId']),
      annotations: {},
      run: async (args) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        if (!isJobActive(project.id)) {
          const busy = await busyReason(project.id, { ignoreGuide: true });
          if (busy === 'busy-elsewhere') return fail('The translation runs in another browser tab.', 'Ask the user to pause it in that tab.');
          return ok({ paused: false, status: getJobState(project.id).status, note: 'No translation is running for this book in this tab.' });
        }
        pauseJob(project.id);
        return ok({ paused: true, status: getJobState(project.id).status });
      },
    },
  ];
}
