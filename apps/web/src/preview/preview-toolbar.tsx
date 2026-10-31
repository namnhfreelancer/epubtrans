import { EXPORT_MODES, type ExportMode } from '@epubtrans/core';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { INPUT_CLASS } from '../components/ui/input-class';
import { useI18n } from '../i18n/i18n-context';
import { usePreviewText } from './preview-messages';
import {
  clampFontScale,
  DEVICE_PRESETS,
  type DeviceId,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  PREVIEW_FLOWS,
  PREVIEW_THEMES,
  type PreviewFlow,
  type PreviewSettings,
  type PreviewTheme,
} from './preview-settings';

const SELECT_CLASS = `${INPUT_CLASS.replace('w-full', 'w-auto')} py-1.5`;

function Control({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-stone-600 dark:text-stone-400">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Layout (export mode, from core's list so new modes appear on their own) plus the preview-only reader settings. */
export function PreviewToolbar({ settings, onChange }: { settings: PreviewSettings; onChange: (patch: Partial<PreviewSettings>) => void }) {
  const { t } = useI18n();
  const p = usePreviewText();
  const zoom = (delta: number) => onChange({ fontScale: clampFontScale(settings.fontScale + delta) });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Control id="preview-mode" label={p('preview.mode')}>
        <select
          id="preview-mode"
          data-testid="preview-mode"
          className={SELECT_CLASS}
          value={settings.mode}
          onChange={(e) => onChange({ mode: e.target.value as ExportMode })}
        >
          {EXPORT_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`export.mode.${m}`)}
            </option>
          ))}
        </select>
      </Control>
      <Control id="preview-device" label={p('preview.device')}>
        <select
          id="preview-device"
          data-testid="preview-device"
          className={SELECT_CLASS}
          value={settings.device}
          onChange={(e) => onChange({ device: e.target.value as DeviceId })}
        >
          {DEVICE_PRESETS.map((d) => (
            <option key={d.id} value={d.id}>
              {p(`preview.device.${d.id}`)}
            </option>
          ))}
        </select>
      </Control>
      <Control id="preview-theme" label={p('preview.theme')}>
        <select
          id="preview-theme"
          data-testid="preview-theme"
          className={SELECT_CLASS}
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value as PreviewTheme })}
        >
          {PREVIEW_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {p(`preview.theme.${theme}`)}
            </option>
          ))}
        </select>
      </Control>
      <Control id="preview-flow" label={p('preview.flow')}>
        <select
          id="preview-flow"
          data-testid="preview-flow"
          className={SELECT_CLASS}
          value={settings.flow}
          onChange={(e) => onChange({ flow: e.target.value as PreviewFlow })}
        >
          {PREVIEW_FLOWS.map((flow) => (
            <option key={flow} value={flow}>
              {p(`preview.flow.${flow}`)}
            </option>
          ))}
        </select>
      </Control>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-stone-600 dark:text-stone-400">{p('preview.fontSize')}</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            aria-label={p('preview.fontSmaller')}
            data-testid="preview-font-smaller"
            disabled={settings.fontScale <= FONT_SCALE_MIN}
            onClick={() => zoom(-FONT_SCALE_STEP)}
          >
            A−
          </Button>
          <span data-testid="preview-font-scale" className="w-12 text-center text-sm tabular-nums">
            {settings.fontScale}%
          </span>
          <Button
            size="sm"
            aria-label={p('preview.fontLarger')}
            data-testid="preview-font-larger"
            disabled={settings.fontScale >= FONT_SCALE_MAX}
            onClick={() => zoom(FONT_SCALE_STEP)}
          >
            A+
          </Button>
        </div>
      </div>
      <label className="flex items-center gap-2 pb-1.5 text-sm">
        <input
          type="checkbox"
          data-testid="preview-show-issues"
          className="accent-teal-700"
          checked={settings.showIssues}
          onChange={(e) => onChange({ showIssues: e.target.checked })}
        />
        {p('preview.showIssues')}
      </label>
    </div>
  );
}
