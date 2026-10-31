import type { ToolContext } from './tool-context';
import { type ToolArgs, ToolInputError, validateInput } from './tool-input';
import { clip, fail, serializeResult, type ToolResult } from './tool-result';
import type { JsonSchemaProperty, ModelContextTool, ToolAnnotations, ToolInputSchema } from './webmcp-types';

/** A tool before it is bound to the browser: its handler receives validated arguments and returns a result object. */
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: ToolAnnotations;
  run(args: ToolArgs, signal: AbortSignal | undefined): Promise<ToolResult>;
}

/** Builds a strict object schema (`additionalProperties: false`). */
export const objectSchema = (properties: Record<string, JsonSchemaProperty>, required: readonly string[] = []): ToolInputSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const BOOK_ID: JsonSchemaProperty = { type: 'string', description: 'Book id as returned by list_books.', maxLength: 200 };

export const CANCELLED = (): ToolResult => fail('The call was cancelled.');

/**
 * Binds a tool spec to the browser: input is re-validated against the schema, the handler never throws to the agent
 * (every failure resolves `{ok:false,error,hint}`), and every output is redacted and kept within the size budget.
 */
export function bindTool(spec: ToolSpec, ctx: ToolContext): ModelContextTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    execute: async (input, client) => {
      const signal = client?.signal instanceof AbortSignal ? client.signal : undefined;
      let result: ToolResult;
      try {
        result = signal?.aborted ? CANCELLED() : await spec.run(validateInput(spec.inputSchema, input), signal);
      } catch (err) {
        if (err instanceof ToolInputError) result = fail(err.message, 'Fix the input and call the tool again.');
        else if (signal?.aborted) result = CANCELLED();
        else result = fail(`Unexpected error: ${clip(err instanceof Error ? err.message : String(err), 300)}`);
      }
      return serializeResult(result, ctx.secrets());
    },
  };
}
