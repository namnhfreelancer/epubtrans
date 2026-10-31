import { createDefaultSettings, type Project } from '@epubtrans/core';
import { strToU8, zipSync } from 'fflate';
import { DOMParser } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArchiveLoader, hardenBook, injectScriptBlockingCsp, PREVIEW_DOCUMENT_CSP } from '../src/preview/preview-book-loader';
import { externalLinkTarget, openExternalLink } from '../src/preview/preview-external-link';
import { previewFingerprint } from '../src/preview/preview-fingerprint';
import { PREVIEW_MESSAGES } from '../src/preview/preview-messages';
import { removeNetworkHints } from '../src/preview/preview-network-hints';
import { previewReaderCss } from '../src/preview/preview-reader-css';
import {
  DEFAULT_PREVIEW_SETTINGS,
  DEVICE_PRESETS,
  devicePreset,
  fitDevice,
  loadPreviewSettings,
  savePreviewSettings,
  validatePreviewSettings,
} from '../src/preview/preview-settings';
import type { FoliateBook } from '../src/preview/third-party/foliate-js/epub.js';
import { REBUILD_DEBOUNCE_MS, REBUILD_MAX_WAIT_MS, rebuildDelay } from '../src/preview/use-preview-export';

/** linkedom has no XMLSerializer; its nodes serialize themselves (XML syntax for XML documents). */
class LinkedomXMLSerializer {
  serializeToString(node: { toString(): string }): string {
    return node.toString();
  }
}

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

describe('preview document hardening', () => {
  it('puts a script-blocking policy first in <head>', () => {
    const out = injectScriptBlockingCsp('<html xmlns="http://www.w3.org/1999/xhtml"><head lang="en"><title>x</title></head><body/></html>');
    expect(out).toContain(`<head lang="en"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_DOCUMENT_CSP}"/><title>`);
    expect(PREVIEW_DOCUMENT_CSP).toContain("script-src 'none'");
    expect(injectScriptBlockingCsp('<svg/>')).toBe('<svg/>');
    // <header> is not <head>.
    expect(injectScriptBlockingCsp('<body><header>a</header></body>')).toBe('<body><header>a</header></body>');
  });

  it('blocks script resources and rewrites markup documents through the book hooks', async () => {
    const target = new EventTarget();
    hardenBook({ transformTarget: target, sections: [], destroy: () => {} } satisfies FoliateBook);
    const script = { type: 'application/javascript', isScript: true, allow: true };
    target.dispatchEvent(new CustomEvent('load', { detail: script }));
    expect(script.allow).toBe(false);
    const image = { type: 'image/png', isScript: false, allow: true };
    target.dispatchEvent(new CustomEvent('load', { detail: image }));
    expect(image.allow).toBe(true);

    const page = { name: 'a.xhtml', type: 'application/xhtml+xml', data: '<html><head></head></html>' as string | Promise<string> };
    target.dispatchEvent(new CustomEvent('data', { detail: page }));
    expect(await page.data).toContain("script-src 'none'");
    const css = { name: 'a.css', type: 'text/css', data: 'head{}' };
    target.dispatchEvent(new CustomEvent('data', { detail: css }));
    expect(css.data).toBe('head{}');
  });

  it('strips network hints and meta refresh from markup documents through the data hook', async () => {
    vi.stubGlobal('DOMParser', DOMParser);
    vi.stubGlobal('XMLSerializer', LinkedomXMLSerializer);
    try {
      const target = new EventTarget();
      hardenBook({ transformTarget: target, sections: [], destroy: () => {} } satisfies FoliateBook);
      const xhtml =
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="refresh" content="0;url=https://evil.example/"/>' +
        '<link rel="prefetch" href="https://evil.example/p"/><link rel="stylesheet" href="a.css"/></head><body><p>keep</p></body></html>';
      const page = { name: 'a.xhtml', type: 'application/xhtml+xml', data: xhtml as string | Promise<string> };
      target.dispatchEvent(new CustomEvent('data', { detail: page }));
      const out = (await page.data) as string;
      expect(out).not.toMatch(/refresh|prefetch|evil\.example/);
      expect(out).toContain('rel="stylesheet"');
      expect(out).toContain('<p>keep</p>');
      expect(out).toContain("script-src 'none'");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a book without resource hooks', () => {
    expect(() => hardenBook({ sections: [], destroy: () => {} })).toThrow(/resource hooks/);
  });

  it('reads archive entries as text, blobs and sizes', async () => {
    const loader = createArchiveLoader(zipSync({ 'OEBPS/a.xhtml': strToU8('<p>ä</p>') }));
    expect(await loader.loadText('OEBPS/a.xhtml')).toBe('<p>ä</p>');
    expect(await loader.loadText('missing')).toBeNull();
    const blob = await loader.loadBlob('OEBPS/a.xhtml', 'application/xhtml+xml');
    expect(blob?.type).toBe('application/xhtml+xml');
    expect(loader.getSize('OEBPS/a.xhtml')).toBe(9);
    expect(loader.getSize('missing')).toBe(0);
  });
});

describe('network hint removal', () => {
  beforeEach(() => {
    vi.stubGlobal('DOMParser', DOMParser);
    vi.stubGlobal('XMLSerializer', LinkedomXMLSerializer);
  });
  afterEach(() => vi.unstubAllGlobals());

  const xhtml = (head: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body><p>text</p></body></html>`;

  it('drops refresh metas in any case and spacing, and keeps other metas', () => {
    const out = removeNetworkHints(
      xhtml(
        '<meta http-equiv=" Refresh " content="5;url=https://evil.example/"/><meta http-equiv="refresh" content="0"/><meta charset="utf-8"/><meta name="viewport" content="width=1"/>',
      ),
      'application/xhtml+xml',
    );
    expect(out).not.toMatch(/refresh/i);
    expect(out).toContain('charset="utf-8"');
    expect(out).toContain('name="viewport"');
  });

  it.each(['prefetch', 'preconnect', 'dns-prefetch', 'prerender', 'preload', 'modulepreload', 'ICON Prefetch'])('drops <link rel="%s">', (rel) => {
    const out = removeNetworkHints(xhtml(`<link rel="${rel}" href="https://evil.example/x"/><link rel="stylesheet" href="s.css"/>`), 'application/xhtml+xml');
    expect(out).not.toContain('evil.example');
    expect(out).toContain('href="s.css"');
  });

  it('handles text/html documents', () => {
    const out = removeNetworkHints(
      '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example/"><link rel=prefetch href="https://evil.example/p"></head><body><p>x</p></body></html>',
      'text/html',
    );
    expect(out).not.toMatch(/refresh|evil\.example/);
    expect(out).toContain('<p>x</p>');
  });

  it('returns documents without hints byte for byte', () => {
    const plain = xhtml('<title>t</title><link rel="stylesheet" href="s.css"/>');
    expect(removeNetworkHints(plain, 'application/xhtml+xml')).toBe(plain);
    const mentionsRefresh = xhtml('<title>refresh</title>');
    expect(removeNetworkHints(mentionsRefresh, 'application/xhtml+xml')).toBe(mentionsRefresh);
  });
});

describe('external links', () => {
  it('accepts only absolute http, https and mailto URLs', () => {
    expect(externalLinkTarget('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(externalLinkTarget('  HTTP://example.com ')).toBe('http://example.com/');
    expect(externalLinkTarget('mailto:a@example.com')).toBe('mailto:a@example.com');
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,x',
      'blob:https://x/1',
      'file:///etc/passwd',
      'ftp://x/',
      '//example.com',
      'chapter1.xhtml',
      '',
      null,
      undefined,
    ]) {
      expect(externalLinkTarget(bad)).toBeUndefined();
    }
  });

  it('opens a new tab with noopener and noreferrer, and nothing for other schemes', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    try {
      openExternalLink('https://example.com/');
      openExternalLink('javascript:alert(1)');
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('preview settings', () => {
  it('validates stored values field by field', () => {
    expect(validatePreviewSettings('x')).toBeUndefined();
    expect(validatePreviewSettings({ device: 'phone', theme: 'evil', flow: 'scrolled', fontScale: 1234, showIssues: 'yes', mode: 'nope' })).toEqual({
      ...DEFAULT_PREVIEW_SETTINGS,
      device: 'phone',
      flow: 'scrolled',
      fontScale: 200,
    });
    expect(validatePreviewSettings({ fontScale: 104 })?.fontScale).toBe(100);
  });

  it('round-trips through storage and falls back on corrupt data', () => {
    const storage = memoryStorage();
    expect(loadPreviewSettings(storage)).toEqual(DEFAULT_PREVIEW_SETTINGS);
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, theme: 'sepia' }, storage);
    expect(loadPreviewSettings(storage).theme).toBe('sepia');
    storage.setItem('epubtrans:preview-settings', '{broken');
    expect(loadPreviewSettings(storage)).toEqual(DEFAULT_PREVIEW_SETTINGS);
  });

  it('fits device frames into the available area without enlarging them', () => {
    const phone = devicePreset('phone');
    expect(fitDevice(phone, 2000, 2000)).toEqual({ width: 390, height: 844 });
    expect(fitDevice(phone, 2000, 422)).toEqual({ width: 195, height: 422 });
    expect(fitDevice(devicePreset('desktop'), 1000.7, 600)).toEqual({ width: 1000, height: 600 });
    const kindle = devicePreset('kindle');
    expect((kindle.width ?? 0) / (kindle.height ?? 1)).toBeCloseTo(1236 / 1648, 2);
    expect(new Set(DEVICE_PRESETS.map((d) => d.id))).toEqual(new Set(['kindle', 'phone', 'tablet', 'desktop']));
  });
});

describe('preview reader css', () => {
  it('applies theme and font size, and highlights issues only when asked', () => {
    const css = previewReaderCss({ theme: 'dark', fontScale: 130, showIssues: true }, 'Lỗi');
    expect(css).toContain('font-size: 130%');
    expect(css).toContain('#121212');
    expect(css).toMatch(/\.et-error \{ outline: 2px solid/);
    expect(css).toContain('content: "Lỗi"');
    expect(css).toMatch(/\.et-pending \{ outline: 1px dashed/);
    const quiet = previewReaderCss({ theme: 'light', fontScale: 100, showIssues: false }, 'Error');
    expect(quiet).not.toContain('et-error');
    expect(quiet).not.toContain('et-pending');
  });

  it('escapes the badge text', () => {
    expect(previewReaderCss({ theme: 'light', fontScale: 100, showIssues: true }, 'a"b\\c}\n')).toContain('content: "a\\"b\\\\c} "');
  });
});

describe('preview rebuild timing', () => {
  it('debounces edits but never waits past the cap', () => {
    expect(rebuildDelay(1000, 1000)).toBe(REBUILD_DEBOUNCE_MS);
    expect(rebuildDelay(1000 + REBUILD_MAX_WAIT_MS - 100, 1000)).toBe(100);
    expect(rebuildDelay(1000 + REBUILD_MAX_WAIT_MS + 50, 1000)).toBe(0);
  });
});

describe('preview messages', () => {
  it('have the same keys and placeholders in every locale', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = PREVIEW_MESSAGES.en;
    for (const [locale, messages] of Object.entries(PREVIEW_MESSAGES)) {
      expect(Object.keys(messages).sort(), locale).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), key).not.toBe('');
        expect(placeholders(value), key).toEqual(placeholders(en[key as keyof typeof en]));
      }
    }
  });
});

describe('preview fingerprint', () => {
  const project = (): Project => ({
    schemaVersion: 1,
    id: 'p1',
    title: 'T',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    settings: createDefaultSettings({ model: 'm', targetLang: 'vi', sourceLang: 'en' }),
    chapters: [{ href: 'c.xhtml', title: 'C', segments: [{ id: 's1', sourceHtml: 'a', sourceText: 'a', status: 'pending' }] }],
    sourceEpub: new Uint8Array([1, 2, 3]),
  });

  it('changes with anything an export depends on, and only then', () => {
    const base = project();
    const fp = previewFingerprint(base, 'bilingual');
    expect(previewFingerprint(project(), 'bilingual')).toBe(fp);
    expect(previewFingerprint({ ...project(), updatedAt: '2027-01-01T00:00:00.000Z' }, 'bilingual')).toBe(fp);
    expect(previewFingerprint(base, 'translation-only')).not.toBe(fp);
    const edited = project();
    const segment = edited.chapters[0]?.segments[0];
    if (!segment) throw new Error('fixture');
    segment.translationHtml = 'b';
    segment.status = 'translated';
    expect(previewFingerprint(edited, 'bilingual')).not.toBe(fp);
    const failed = project();
    if (failed.chapters[0]?.segments[0]) failed.chapters[0].segments[0].status = 'error';
    expect(previewFingerprint(failed, 'bilingual')).not.toBe(fp);
    const retargeted = project();
    retargeted.settings = { ...retargeted.settings, targetLang: 'fr' };
    expect(previewFingerprint(retargeted, 'bilingual')).not.toBe(fp);
  });
});
