import type { Project } from '@epubtrans/core';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { ExportStyleEditor } from '../components/export-style/export-style-editor';
import { useStyleText } from '../components/export-style/export-style-messages';
import { Button } from '../components/ui/button';
import { Alert } from '../components/ui/layout-primitives';
import { navigate } from '../lib/hash-route';
import { errorText } from '../lib/notices';
import { usePreviewText } from './preview-messages';
import { type PreviewLocation, PreviewReaderController } from './preview-reader-controller';
import { previewReaderCss } from './preview-reader-css';
import { devicePreset, fitDevice, loadPreviewSettings, type PreviewSettings, savePreviewSettings } from './preview-settings';
import { PreviewSidebar } from './preview-sidebar';
import { PreviewToolbar } from './preview-toolbar';
import type { TocItem } from './third-party/foliate-js/epub.js';
import { usePreviewExport } from './use-preview-export';

/** Viewport height kept free for the app header and the page controls when the frame is scrolled into view. */
const FRAME_CHROME_HEIGHT = 160;
const MIN_FRAME_HEIGHT = 360;
const DESKTOP_MAX_HEIGHT = 900;

/** Width of the element and the usable viewport height, kept up to date. */
function useAvailableArea(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [area, setArea] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: Math.max(MIN_FRAME_HEIGHT, window.innerHeight - FRAME_CHROME_HEIGHT) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  return area;
}

/**
 * The "Preview" tab: renders the EPUB that export would produce (with segment ids and issue classes) in foliate-js,
 * on an emulated device. Edits rebuild it in place; a click on a paragraph opens that segment in the editor.
 */
export function PreviewPanel({ project, version }: { project: Project; version: number }) {
  const p = usePreviewText();
  const s = useStyleText();
  const [settings, setSettings] = useState<PreviewSettings>(loadPreviewSettings);
  const build = usePreviewExport(project, version, settings.mode);
  const hostRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useAvailableArea(areaRef);
  const [controller, setController] = useState<PreviewReaderController>();
  const [toc, setToc] = useState<TocItem[]>([]);
  const [location, setLocation] = useState<PreviewLocation>();
  const [openError, setOpenError] = useState<string>();
  const [opened, setOpened] = useState(false);
  const preset = devicePreset(settings.device);
  const css = useMemo(() => previewReaderCss(settings, p('preview.issueBadge')), [settings, p]);

  const update = (patch: Partial<PreviewSettings>) => setSettings((s) => ({ ...s, ...patch }));
  useEffect(() => savePreviewSettings(settings), [settings]);

  // One foliate view per mounted panel.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const instance = new PreviewReaderController(host, {
      onRelocate: setLocation,
      onSegmentClick: (segment) => navigate({ name: 'book', id: project.id, tab: 'read', segment }),
    });
    setController(instance);
    return () => instance.dispose();
  }, [project.id]);

  useEffect(() => {
    if (!controller || !build.bytes) return;
    let current = true;
    controller.open(build.bytes).then(
      () => {
        if (!current) return;
        setOpenError(undefined);
        setOpened(true);
        setToc(controller.toc);
      },
      (err: unknown) => current && setOpenError(errorText(err)),
    );
    return () => {
      current = false;
    };
  }, [controller, build.bytes]);

  useEffect(() => controller?.setStyles(css), [controller, css]);
  useEffect(() => controller?.setLayout({ flow: settings.flow, preset }), [controller, settings.flow, preset]);

  // Arrow keys turn pages while the preview is on screen (the frame handles them itself when it has focus).
  useEffect(() => {
    if (!controller) return;
    const onKeyDown = (e: KeyboardEvent) => controller.handleKey(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);

  const frame = preset.width ? fitDevice(preset, area.width, area.height) : { width: area.width, height: Math.min(area.height, DESKTOP_MAX_HEIGHT) };
  const percent = Math.round((location?.fraction ?? 0) * 100);
  const status = build.error ? undefined : !opened ? p('preview.loading') : build.building ? p('preview.updating') : undefined;

  return (
    <div data-testid="preview-panel" className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <PreviewSidebar controller={opened ? controller : undefined} toc={toc} currentHref={location?.tocHref} />
      <div className="min-w-0 space-y-3">
        <PreviewToolbar settings={settings} onChange={update} />
        <p className="text-xs text-stone-500 dark:text-stone-400">{p('preview.hint')}</p>
        {build.error && <Alert kind="error">{p('preview.failed', { message: build.error })}</Alert>}
        {openError && <Alert kind="error">{p('preview.failed', { message: openError })}</Alert>}
        <div ref={areaRef} className="flex w-full justify-center">
          <section
            data-testid="preview-frame"
            data-device={preset.id}
            data-theme={settings.theme}
            data-flow={settings.flow}
            aria-label={p('preview.frameLabel')}
            aria-busy={status !== undefined}
            className={`relative overflow-hidden border border-stone-300 shadow-sm dark:border-stone-700 ${preset.width ? 'rounded-[1.25rem] border-[6px] border-stone-800 dark:border-stone-600' : 'rounded-xl'}`}
            style={{ width: frame.width || undefined, height: frame.height || undefined }}
          >
            <div ref={hostRef} className="h-full w-full" />
            {status && (
              <div data-testid="preview-status" className="absolute inset-x-0 top-0 bg-stone-900/70 px-3 py-1 text-center text-xs text-white">
                {status}
              </div>
            )}
          </section>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" data-testid="preview-prev" aria-label={p('preview.prev')} disabled={!opened} onClick={() => void controller?.prev()}>
            ←
          </Button>
          <span
            data-testid="preview-progress"
            data-fraction={location?.fraction ?? 0}
            className="min-w-[10rem] truncate text-center text-sm tabular-nums text-stone-600 dark:text-stone-400"
          >
            {p('preview.progress', { percent })}
            {location?.tocLabel ? ` · ${location.tocLabel.trim()}` : ''}
          </span>
          <Button size="sm" data-testid="preview-next" aria-label={p('preview.next')} disabled={!opened} onClick={() => void controller?.next()}>
            →
          </Button>
        </div>
        {/* The book's export style, edited next to the preview: changes are saved and rebuild the preview (debounced). */}
        <details data-testid="preview-style" className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <summary className="cursor-pointer text-sm font-semibold">{s('style.title')}</summary>
          <div className="mt-4">
            <ExportStyleEditor project={project} mode={settings.mode} />
          </div>
        </details>
      </div>
    </div>
  );
}
