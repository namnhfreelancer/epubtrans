import type { ModelContext, ModelContextTool } from './webmcp-types';

/**
 * The only module that touches `document.modelContext`. WebMCP is a pre-standard browser API (Chrome/Edge origin
 * trial or flag), so it is feature-detected: in every other browser registration is a no-op and the app is unchanged.
 * No polyfill is loaded.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The native model context of `host` (default: the page's document), or undefined when the browser has none. */
export function getModelContext(host: unknown = typeof document === 'undefined' ? undefined : document): ModelContext | undefined {
  if (!isObject(host)) return undefined;
  const context = host.modelContext;
  if (!isObject(context) || typeof context.registerTool !== 'function') return undefined;
  return context as unknown as ModelContext;
}

/**
 * Registers every tool with one shared AbortController (no `exposedTo`, so same-origin only) and returns the function
 * that unregisters them all. A failed registration (e.g. a duplicate name, an API change) is logged once and leaves
 * the rest of the app untouched.
 */
export function registerWebMcpTools(tools: readonly ModelContextTool[], context: ModelContext | undefined = getModelContext()): () => void {
  if (!context) return () => {};
  const controller = new AbortController();
  let warned = false;
  const report = (name: string, err: unknown) => {
    if (warned || controller.signal.aborted) return;
    warned = true;
    console.warn(`epubtrans: WebMCP tool registration failed (${name})`, err);
  };
  for (const tool of tools) {
    try {
      Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch((err: unknown) => report(tool.name, err));
    } catch (err) {
      report(tool.name, err);
    }
  }
  return () => controller.abort();
}
