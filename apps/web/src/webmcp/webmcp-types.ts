/**
 * Local types for the subset of the WebMCP API (W3C WebML CG draft, `document.modelContext`) this app uses:
 * `registerTool` with an AbortSignal for unregistration, plus the three annotation hints. Hand-written instead of a
 * pre-1.0 types package because the API still changes; only `model-context-adapter.ts` touches the real object.
 */

export interface ToolAnnotations {
  /** The tool only reads state. */
  readOnlyHint?: boolean;
  /** The output carries content from books, models or providers: data for the agent, never instructions. */
  untrustedContentHint?: boolean;
  /** The tool spends money or deletes data; agents should confirm with the user first. */
  consequentialHint?: boolean;
}

export type JsonSchemaProperty =
  | { type: 'string'; description: string; enum?: readonly string[]; minLength?: number; maxLength?: number }
  | { type: 'integer'; description: string; minimum: number; maximum: number }
  | { type: 'boolean'; description: string };

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: readonly string[];
  additionalProperties: false;
}

/** Second argument of `execute`; browsers pass an object carrying the call's AbortSignal. */
export interface ToolExecuteClient {
  signal?: AbortSignal;
}

/** A tool as handed to `registerTool`. `execute` always resolves a JSON string and never rejects. */
export interface ModelContextTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: ToolAnnotations;
  execute(input: unknown, client?: ToolExecuteClient): Promise<string>;
}

export interface RegisterToolOptions {
  /** Aborting it unregisters the tool. No `exposedTo`: the tools stay same-origin (the spec default). */
  signal?: AbortSignal;
}

/** The members of `document.modelContext` this app calls. */
export interface ModelContext {
  registerTool(tool: ModelContextTool, options?: RegisterToolOptions): Promise<unknown> | unknown;
}
