import { bookTools } from './book-tools';
import { libraryTools } from './library-tools';
import { providerTools } from './provider-tools';
import { segmentTools } from './segment-tools';
import type { ToolContext } from './tool-context';
import { bindTool, type ToolSpec } from './tool-definition';
import { setSecretSource } from './tool-result';
import { translationTools } from './translation-tools';
import type { ModelContextTool } from './webmcp-types';

/** Every tool spec, in a stable order (registered statically: state limits are enforced inside each handler). */
export function webMcpToolSpecs(ctx: ToolContext): ToolSpec[] {
  return [...libraryTools(ctx), ...bookTools(ctx), ...providerTools(), ...translationTools(ctx), ...segmentTools(ctx)];
}

/** The app's WebMCP tools bound to `ctx`, ready for `registerTool`. */
export function createWebMcpTools(ctx: ToolContext): ModelContextTool[] {
  // Handlers clip provider and book text before the final redaction; this lets the clip redact first.
  setSecretSource(() => ctx.secrets());
  return webMcpToolSpecs(ctx).map((spec) => bindTool(spec, ctx));
}
