import type { Page } from '@playwright/test';

/**
 * Installs a minimal `document.modelContext` before the app loads (Playwright's Chromium has no native WebMCP):
 * `registerTool` records tools (unregistering on abort), `executeTool` runs one like an agent would. Init scripts
 * bypass the page CSP, so the production build is tested unchanged.
 */
export async function installModelContextStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Tool = { name: string; execute: (input: unknown, client: { signal: AbortSignal }) => Promise<string> };
    const tools = new Map<string, Tool>();
    const modelContext = {
      registerTool(tool: Tool, options: { signal?: AbortSignal } = {}) {
        if (tools.has(tool.name)) return Promise.reject(new DOMException(`Duplicate tool ${tool.name}`, 'InvalidStateError'));
        tools.set(tool.name, tool);
        options.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
        return Promise.resolve();
      },
      async getTools() {
        return [...tools.values()].map(({ execute: _execute, ...rest }) => rest);
      },
      async executeTool(name: string, input: unknown) {
        const tool = tools.get(name);
        if (!tool) throw new DOMException(`No tool ${name}`, 'NotFoundError');
        return tool.execute(input, { signal: new AbortController().signal });
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', { configurable: true, get: () => modelContext });
  });
}

export interface ToolCallLog {
  outputs: string[];
}

/** Names of the tools the app registered on the stub. */
export function registeredToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = (document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]> } }).modelContext;
    return (await context.getTools()).map((t) => t.name);
  });
}

/** Invokes a tool through the stub and returns its parsed output (the raw output is appended to `log`). */
export async function callTool(page: Page, log: ToolCallLog, name: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const raw = await page.evaluate(
    ({ name, input }) => {
      const context = (document as unknown as { modelContext: { executeTool(name: string, input: unknown): Promise<string> } }).modelContext;
      return context.executeTool(name, input);
    },
    { name, input },
  );
  log.outputs.push(raw);
  if (raw.length > 1500) throw new Error(`${name} output is ${raw.length} characters`);
  return JSON.parse(raw) as Record<string, unknown>;
}
