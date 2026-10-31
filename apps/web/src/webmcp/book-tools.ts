import {
  composeGuideline,
  EXPORT_STYLE_PRESET_IDS,
  type ExportStylePresetId,
  exportStylePreset,
  GUIDELINE_PRESETS,
  matchingPreset,
  type ProjectSettings,
  splitGuideline,
  wordHintSettingsOf,
} from '@epubtrans/core';
import { STYLE_MESSAGES } from '../components/export-style/export-style-messages';
import { formatMessage } from '../i18n/translate-message';
import { isJobRunningElsewhere } from '../lib/cross-tab-job-lock';
import { buildErrorIndex, isWarnedSegment } from '../lib/error-index';
import { dialogText } from '../lib/format';
import { getGuideJobState, isGuideJobRunning } from '../lib/guide-jobs';
import { getHintJobState } from '../lib/hint-jobs';
import { normalizeLanguageTag } from '../lib/languages';
import { targetChangeNeedsDecision, translatedSegmentCount, updateSettings, updateSettingsAndResetTranslations } from '../lib/project-settings-store';
import { getSampleJobState } from '../lib/sample-jobs';
import { countSegments, remainingWork } from '../lib/segment-counts';
import { getJobState } from '../lib/translation-jobs';
import { currentProviderState } from '../lib/use-active-provider';
import { englishMessage, estimateRemaining, findBook, isFailure, type ToolContext } from './tool-context';
import { BOOK_ID, objectSchema, type ToolSpec } from './tool-definition';
import { fail, ok, untrustedText } from './tool-result';

const PRESET_IDS = GUIDELINE_PRESETS.map((p) => p.id);
const GUIDE_LOCKED_HINT = 'Wait until generate_guide finishes (poll get_book_status), then set the preset again.';

/**
 * Whether a style preset may replace the book's export style: always over a preset look, but a custom style (one the
 * user built field by field or applied from a template) is only replaced with the user's approval in the page.
 */
function applyStylePreset(settings: ProjectSettings, id: ExportStylePresetId, ctx: ToolContext): { applied: boolean } {
  const custom = settings.exportStyle !== undefined && matchingPreset(settings.exportStyle) === undefined;
  if (!custom) return { applied: true };
  const messages = STYLE_MESSAGES[ctx.locale()];
  const question = formatMessage(messages['style.presetConfirm'], { preset: messages[`style.preset.${id}`] });
  return { applied: ctx.confirm(ctx.t('webmcp.agentAsks', { question })) };
}

/** Book tools: read the status, change the language pair, two-pass mode and guideline preset. */
export function bookTools(ctx: ToolContext): ToolSpec[] {
  return [
    {
      name: 'get_book_status',
      title: 'Get book status',
      description:
        'Returns one book’s settings and progress: languages, two-pass mode, segment counts, remaining work, the translation job (status, phase, progress, token usage), sample and guide generation status, glossary size, Word Wise hints state (enabled, level, glossed words, job status), the configured provider and model, and the cost estimate of the remaining work. Poll it to follow a running translation.',
      inputSchema: objectSchema({ bookId: BOOK_ID }, ['bookId']),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      run: async (args, signal) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const { settings } = project;
        const counts = countSegments(project);
        const job = getJobState(project.id);
        const sample = getSampleJobState(project.id);
        const guide = getGuideJobState(project.id);
        const hints = wordHintSettingsOf(settings);
        const provider = currentProviderState();
        return ok({
          bookId: project.id,
          title: untrustedText(project.title, 100),
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
          twoPass: settings.twoPass,
          counts: {
            total: counts.total,
            translated: counts.translated,
            reviewed: counts.reviewed,
            pending: counts.pending,
            failed: counts.error,
            identicalToSource: buildErrorIndex(project.chapters, isWarnedSegment).locations.length,
          },
          remaining: remainingWork(counts, settings.twoPass),
          job: {
            status: job.status,
            phase: job.phase,
            done: job.done,
            total: job.total,
            usage: job.usage,
            ...(job.error ? { error: untrustedText(job.error, 200) } : {}),
          },
          busyElsewhere: await isJobRunningElsewhere(project.id),
          sample: {
            status: sample.status,
            done: sample.done,
            total: sample.total,
            failed: sample.failed.length,
            keptEdited: sample.keptEdited.length,
            ...(sample.error ? { error: untrustedText(sample.error, 160) } : {}),
          },
          guide: { status: guide.kind, ...(guide.kind === 'error' ? { error: untrustedText(guide.message, 160) } : {}) },
          wordHints: {
            enabled: hints.enabled,
            level: hints.level,
            glossedWords: project.wordHints?.entries.length ?? 0,
            job: getHintJobState(project.id).status,
          },
          exportStyle: { preset: matchingPreset(settings.exportStyle) ?? 'custom', attribution: settings.attribution === true },
          guidelineChars: settings.guideline.length,
          glossaryEntries: settings.glossary.length,
          provider: {
            providerId: provider.active.providerId,
            model: untrustedText(provider.active.model, 100),
            ready: !provider.problem,
            ...(provider.problem ? { problem: englishMessage(provider.problem) } : {}),
          },
          estimate: await estimateRemaining(project, provider, signal),
        });
      },
    },
    {
      name: 'update_book_settings',
      title: 'Update book settings',
      description:
        'Changes a book’s languages (BCP 47 tags; source also accepts auto), two-pass review, guideline preset or export style preset. A translated book keeps its target language unless resetTranslations is true and the user approves (all segments go back to pending). A guideline preset replaces only the base guideline, keeping the generated block, and is not applied while generation runs (see notApplied). Replacing custom guideline text or a custom style needs the user’s approval.',
      inputSchema: objectSchema(
        {
          bookId: BOOK_ID,
          targetLang: { type: 'string', description: 'Target language as a BCP 47 tag, e.g. vi, fr, zh-Hans.', maxLength: 35 },
          sourceLang: { type: 'string', description: 'Source language as a BCP 47 tag, or auto to detect it.', maxLength: 35 },
          twoPass: { type: 'boolean', description: 'Review every draft in a second pass: better quality, about twice the cost.' },
          guidelinePreset: { type: 'string', enum: PRESET_IDS, description: 'Base style guideline to apply.' },
          resetTranslations: {
            type: 'boolean',
            description: 'With a new targetLang on a book that has translations: reset every segment to pending (the user must approve).',
          },
          stylePreset: { type: 'string', enum: [...EXPORT_STYLE_PRESET_IDS], description: 'Look of the exported book.' },
        },
        ['bookId'],
      ),
      annotations: {},
      run: async (args) => {
        const project = await findBook(args.string('bookId'));
        if (isFailure(project)) return project;
        const targetInput = args.optString('targetLang');
        const sourceInput = args.optString('sourceLang');
        const twoPass = args.optBool('twoPass');
        const presetId = args.optString('guidelinePreset');
        const resetRequested = args.optBool('resetTranslations') === true;
        const stylePresetId = EXPORT_STYLE_PRESET_IDS.find((id) => id === args.optString('stylePreset'));
        if (targetInput === undefined && sourceInput === undefined && twoPass === undefined && presetId === undefined && stylePresetId === undefined) {
          return fail('Nothing to change.', 'Pass at least one of targetLang, sourceLang, twoPass, guidelinePreset, stylePreset.');
        }
        const patch: Partial<ProjectSettings> = {};
        let reset = false;
        if (targetInput !== undefined) {
          const tag = normalizeLanguageTag(targetInput);
          if (!tag) return fail(`"${targetInput}" is not a valid language tag.`, 'Use a BCP 47 tag such as vi, fr or zh-Hans.');
          if (targetChangeNeedsDecision(project, tag)) {
            const n = translatedSegmentCount(project);
            if (!resetRequested) {
              return fail(
                `This book already has ${n} translated segments into ${project.settings.targetLang}; changing the target language now would mix two languages in one book. Nothing was changed.`,
                'Keep the current target language, or call update_book_settings again with resetTranslations: true to translate the book again (the user must approve; existing translations are dropped).',
              );
            }
            const question = ctx.t('webmcp.resetConfirm', { title: dialogText(project.title, 120), n, from: project.settings.targetLang, to: tag });
            if (!ctx.confirm(ctx.t('webmcp.agentAsks', { question }))) return ok({ bookId: project.id, changed: false, reason: 'declined' });
            reset = true;
          }
          patch.targetLang = tag;
        }
        if (resetRequested && !reset) {
          return fail('resetTranslations only applies when targetLang changes on a book that has translations. Nothing was changed.');
        }
        if (sourceInput !== undefined) {
          const tag = sourceInput.toLowerCase() === 'auto' ? 'auto' : normalizeLanguageTag(sourceInput);
          if (!tag) return fail(`"${sourceInput}" is not a valid language tag.`, 'Use a BCP 47 tag such as en or ja, or auto.');
          patch.sourceLang = tag;
        }
        if (twoPass !== undefined) patch.twoPass = twoPass;
        const stylePreset = stylePresetId === undefined ? undefined : applyStylePreset(project.settings, stylePresetId, ctx);
        if (stylePreset?.applied) patch.exportStyle = exportStylePreset(stylePresetId as ExportStylePresetId);
        // Like the setup page, the guideline is locked while generation runs: its result is merged into the guideline
        // it started from and would silently overwrite a preset applied now.
        const guideLocked = presetId !== undefined && isGuideJobRunning(project.id);
        if (guideLocked && Object.keys(patch).length === 0) {
          return fail('The guideline is locked while guideline and glossary generation runs for this book.', GUIDE_LOCKED_HINT);
        }
        let preset: 'applied' | 'declined' | undefined;
        const chosen = guideLocked ? undefined : GUIDELINE_PRESETS.find((p) => p.id === presetId);
        if (chosen) {
          const { base, generated } = splitGuideline(project.settings.guideline);
          // Text the user wrote (not an unchanged preset) is only replaced with their approval, as in the setup page.
          const custom = base !== '' && !GUIDELINE_PRESETS.some((p) => p.guideline.trim() === base);
          const label = ctx.t(`setup.preset.${chosen.id}`);
          const question = generated ? ctx.t('guide.applyPresetKeepsGenerated', { preset: label }) : ctx.t('setup.applyPresetConfirm', { preset: label });
          if (custom && !ctx.confirm(ctx.t('webmcp.agentAsks', { question }))) preset = 'declined';
          else {
            patch.guideline = composeGuideline(chosen.guideline, generated);
            preset = 'applied';
          }
        }
        if (reset) {
          if ((await updateSettingsAndResetTranslations(project, patch)) === 'busy') {
            return fail(
              'The book is being translated or sampled (in this tab or another one); nothing was changed.',
              'Wait until the run finishes or pause it, then try again.',
            );
          }
        } else if (Object.keys(patch).length > 0) await updateSettings(project, patch);
        ctx.navigate({ name: 'book', id: project.id, tab: 'setup' });
        const { settings } = project;
        return ok({
          bookId: project.id,
          targetLang: settings.targetLang,
          sourceLang: settings.sourceLang,
          twoPass: settings.twoPass,
          ...(reset ? { translationsReset: true } : {}),
          ...(preset ? { guidelinePreset: preset === 'applied' ? chosen?.id : 'declined by the user' } : {}),
          ...(stylePreset ? { stylePreset: stylePreset.applied ? stylePresetId : 'declined by the user' } : {}),
          ...(guideLocked ? { notApplied: ['guidelinePreset'], note: `guidelinePreset: generation is running. ${GUIDE_LOCKED_HINT}` } : {}),
        });
      },
    },
  ];
}
