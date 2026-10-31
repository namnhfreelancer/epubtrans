import {
  EMBEDDED_FONTS,
  EXPORT_STYLE_PRESET_IDS,
  type ExportMode,
  type ExportStyle,
  type ExportStylePresetId,
  embeddedFontsFor,
  embeddedFontsSize,
  exportStylePreset,
  GENERIC_FONTS,
  matchingPreset,
  type Project,
} from '@epubtrans/core';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import {
  DEFAULT_PICKER_COLOR,
  formatByteSize,
  optionalFont,
  optionalNumber,
  optionalWeight,
  patchBlockSpacing,
  patchStyleGroup,
  STYLE_CHOICES,
} from '../../lib/export-style-edit';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-store';
import { INPUT_CLASS } from '../ui/input-class';
import { type StyleTranslate, useStyleText } from './export-style-messages';

type Save = (next: ExportStyle) => void;

function SelectField({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className="block space-y-1 text-xs font-medium text-stone-600 dark:text-stone-400">
      <span>{label}</span>
      <select id={id} data-testid={id} className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

/** A color that defaults to the reader's: the picker only applies while "custom color" is ticked. */
function ColorField({ id, s, value, onChange }: { id: string; s: StyleTranslate; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="space-y-1 text-xs font-medium text-stone-600 dark:text-stone-400">
      <span className="block">{s('style.color')}</span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            data-testid={`${id}-custom`}
            className="h-4 w-4 accent-teal-700"
            checked={value !== undefined}
            onChange={(e) => onChange(e.target.checked ? DEFAULT_PICKER_COLOR : undefined)}
          />
          {s('style.customColor')}
        </label>
        <input
          type="color"
          data-testid={id}
          aria-label={s('style.color')}
          className="h-8 w-12 cursor-pointer rounded border border-stone-300 bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700"
          value={value ?? DEFAULT_PICKER_COLOR}
          disabled={value === undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function FontField({ id, s, value, onChange }: { id: string; s: StyleTranslate; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <SelectField id={id} label={s('style.font')} value={value ?? ''} onChange={onChange}>
      <option value="">{s('style.inherit')}</option>
      {GENERIC_FONTS.map((f) => (
        <option key={f} value={f}>
          {s(`style.font.${f}`)}
        </option>
      ))}
      {EMBEDDED_FONTS.map((f) => (
        <option key={f.id} value={f.id}>
          {s('style.font.embedded', { family: f.family })}
        </option>
      ))}
    </SelectField>
  );
}

function SizeField({
  id,
  s,
  value,
  choices,
  onChange,
}: {
  id: string;
  s: StyleTranslate;
  value: number | undefined;
  choices: readonly number[];
  onChange: (v: string) => void;
}) {
  return (
    <SelectField id={id} label={s('style.size')} value={value === undefined ? '' : String(value)} onChange={onChange}>
      <option value="">{s('style.default')}</option>
      {choices.map((n) => (
        <option key={n} value={n}>
          {n}%
        </option>
      ))}
    </SelectField>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
      <legend className="px-1 text-sm font-medium text-stone-700 dark:text-stone-300">{title}</legend>
      {hint && <p className="text-xs text-stone-500 dark:text-stone-400">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/**
 * Per-book export style: preset, the original text, the translation, block spacing and the Word Wise hint look, plus
 * the opt-in attribution page. Every change is validated by core and saved at once; the preview rebuilds from the
 * saved settings (debounced). `mode` decides which embedded fonts the export needs, for the added size.
 */
export function ExportStyleEditor({ project, mode }: { project: Project; mode: ExportMode }) {
  const s = useStyleText();
  const { locale } = useI18n();
  const style = project.settings.exportStyle;
  const preset = matchingPreset(style) ?? 'custom';
  const fonts = embeddedFontsFor(style, mode);
  const persist = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', s('style.saveFailed', { message: errorText(err) })));
  const save: Save = (next) => void persist({ exportStyle: next });
  const edit = (fn: () => ExportStyle) => {
    try {
      save(fn());
    } catch (err) {
      pushNotice('error', s('style.saveFailed', { message: errorText(err) }));
    }
  };

  return (
    <div data-testid="export-style-editor" className="space-y-4">
      <p className="text-sm text-stone-600 dark:text-stone-400">{s('style.intro')}</p>
      <SelectField
        id="style-preset"
        label={s('style.preset')}
        value={preset}
        onChange={(v) => v !== 'custom' && save(exportStylePreset(v as ExportStylePresetId))}
      >
        {preset === 'custom' && <option value="custom">{s('style.preset.custom')}</option>}
        {EXPORT_STYLE_PRESET_IDS.map((id) => (
          <option key={id} value={id}>
            {s(`style.preset.${id}`)}
          </option>
        ))}
      </SelectField>

      <Group title={s('style.source')} hint={s('style.sourceHint')}>
        <ColorField id="style-source-color" s={s} value={style?.source?.color} onChange={(v) => edit(() => patchStyleGroup(style, 'source', 'color', v))} />
        <SelectField
          id="style-source-opacity"
          label={s('style.opacity')}
          value={style?.source?.opacity === undefined ? '' : String(style.source.opacity)}
          onChange={(v) => edit(() => patchStyleGroup(style, 'source', 'opacity', optionalNumber(v)))}
        >
          <option value="">{s('style.default')} (0.55)</option>
          {STYLE_CHOICES.opacity.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
        <SizeField
          id="style-source-size"
          s={s}
          value={style?.source?.fontSizePercent}
          choices={STYLE_CHOICES.blockSize}
          onChange={(v) => edit(() => patchStyleGroup(style, 'source', 'fontSizePercent', optionalNumber(v)))}
        />
        <FontField
          id="style-source-font"
          s={s}
          value={style?.source?.font}
          onChange={(v) => edit(() => patchStyleGroup(style, 'source', 'font', optionalFont(v)))}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="style-source-italic"
            className="h-4 w-4 accent-teal-700"
            checked={style?.source?.italic === true}
            onChange={(e) => edit(() => patchStyleGroup(style, 'source', 'italic', e.target.checked || undefined))}
          />
          {s('style.italic')}
        </label>
      </Group>

      <Group title={s('style.translation')}>
        <ColorField
          id="style-translation-color"
          s={s}
          value={style?.translation?.color}
          onChange={(v) => edit(() => patchStyleGroup(style, 'translation', 'color', v))}
        />
        <SizeField
          id="style-translation-size"
          s={s}
          value={style?.translation?.fontSizePercent}
          choices={STYLE_CHOICES.blockSize}
          onChange={(v) => edit(() => patchStyleGroup(style, 'translation', 'fontSizePercent', optionalNumber(v)))}
        />
        <FontField
          id="style-translation-font"
          s={s}
          value={style?.translation?.font}
          onChange={(v) => edit(() => patchStyleGroup(style, 'translation', 'font', optionalFont(v)))}
        />
        <SelectField
          id="style-translation-weight"
          label={s('style.weight')}
          value={style?.translation?.fontWeight === undefined ? '' : String(style.translation.fontWeight)}
          onChange={(v) => edit(() => patchStyleGroup(style, 'translation', 'fontWeight', optionalWeight(v)))}
        >
          <option value="">{s('style.inherit')}</option>
          {STYLE_CHOICES.weight.map((w) => (
            <option key={w} value={w}>
              {w === 'normal' || w === 'bold' ? s(`style.weight.${w}`) : w}
            </option>
          ))}
        </SelectField>
      </Group>

      <Group title={s('style.hints')}>
        <ColorField id="style-hint-color" s={s} value={style?.hint?.color} onChange={(v) => edit(() => patchStyleGroup(style, 'hint', 'color', v))} />
        <SizeField
          id="style-hint-size"
          s={s}
          value={style?.hint?.fontSizePercent}
          choices={STYLE_CHOICES.hintSize}
          onChange={(v) => edit(() => patchStyleGroup(style, 'hint', 'fontSizePercent', optionalNumber(v)))}
        />
      </Group>

      <SelectField
        id="style-spacing"
        label={s('style.spacing')}
        value={style?.blockSpacingEm === undefined ? '' : String(style.blockSpacingEm)}
        onChange={(v) => edit(() => patchBlockSpacing(style, optionalNumber(v)))}
      >
        <option value="">{s('style.inherit')}</option>
        {STYLE_CHOICES.spacing.map((n) => (
          <option key={n} value={n}>
            {n} em
          </option>
        ))}
      </SelectField>

      {fonts.length > 0 && (
        <p data-testid="style-fonts-size" className="text-xs text-stone-500 dark:text-stone-400">
          {s('style.fontsSize', { size: formatByteSize(embeddedFontsSize(fonts), locale) })}
        </p>
      )}

      <label className="flex items-start gap-2 border-t border-stone-200 pt-4 text-sm dark:border-stone-800">
        <input
          type="checkbox"
          data-testid="style-attribution"
          className="mt-0.5 h-4 w-4 accent-teal-700"
          checked={project.settings.attribution === true}
          onChange={(e) => void persist({ attribution: e.target.checked })}
        />
        <span>
          <span className="font-medium">{s('style.attribution', { model: project.settings.model || 'AI' })}</span>
          <span className="block text-xs text-stone-500 dark:text-stone-400">{s('style.attributionHint')}</span>
        </span>
      </label>
    </div>
  );
}
