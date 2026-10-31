import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/i18n-context';
import { getModelContext, registerWebMcpTools } from './model-context-adapter';
import { browserToolContext } from './tool-context';
import { createWebMcpTools } from './webmcp-tools';

/**
 * Registers the app's WebMCP tools for the page's lifetime when the browser offers `document.modelContext`; a no-op
 * otherwise. Handlers read the UI language through a ref, so confirm dialogs follow it without re-registering the tools
 * (names and descriptions stay English for agents).
 */
export function useWebMcpTools(): void {
  const i18n = useI18n();
  const i18nRef = useRef(i18n);
  useEffect(() => {
    i18nRef.current = i18n;
  }, [i18n]);

  useEffect(() => {
    const context = getModelContext();
    if (!context) return;
    return registerWebMcpTools(createWebMcpTools(browserToolContext(() => i18nRef.current)), context);
  }, []);
}
