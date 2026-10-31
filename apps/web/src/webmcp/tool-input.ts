import type { ToolInputSchema } from './webmcp-types';

/** Invalid tool arguments; the message tells the agent what to fix. */
export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';
}

type ArgValue = string | number | boolean;

/** Validated arguments with typed accessors. Accessors only see values the schema check already accepted. */
export class ToolArgs {
  constructor(private readonly values: ReadonlyMap<string, ArgValue>) {}

  string(name: string): string {
    const value = this.optString(name);
    if (value === undefined) throw new ToolInputError(`"${name}" is required.`);
    return value;
  }

  optString(name: string): string | undefined {
    const value = this.values.get(name);
    return typeof value === 'string' ? value : undefined;
  }

  optInt(name: string): number | undefined {
    const value = this.values.get(name);
    return typeof value === 'number' ? value : undefined;
  }

  optBool(name: string): boolean | undefined {
    const value = this.values.get(name);
    return typeof value === 'boolean' ? value : undefined;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** Accepts the input object; older Chrome builds passed a JSON string instead, which is parsed. */
function inputObject(input: unknown): Record<string, unknown> {
  let value = input ?? {};
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value === '' ? '{}' : value);
    } catch {
      throw new ToolInputError('The input must be a JSON object.');
    }
  }
  if (!isPlainObject(value)) throw new ToolInputError('The input must be a JSON object.');
  return value;
}

/**
 * Re-validates tool input against its schema in code (agents do not always honour schemas): no unknown properties,
 * required properties present, and every value of the declared type, enum, length and range.
 */
export function validateInput(schema: ToolInputSchema, input: unknown): ToolArgs {
  const raw = inputObject(input);
  const values = new Map<string, ArgValue>();
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(schema.properties, key)) {
      const known = Object.keys(schema.properties);
      throw new ToolInputError(`Unknown property "${key.slice(0, 40)}". ${known.length ? `Allowed: ${known.join(', ')}.` : 'This tool takes no input.'}`);
    }
  }
  for (const name of schema.required) {
    if (raw[name] === undefined || raw[name] === null) throw new ToolInputError(`"${name}" is required.`);
  }
  for (const [name, prop] of Object.entries(schema.properties)) {
    const value = raw[name];
    if (value === undefined || value === null) continue;
    switch (prop.type) {
      case 'string': {
        if (typeof value !== 'string') throw new ToolInputError(`"${name}" must be a string.`);
        const text = value.trim();
        if (prop.enum && !prop.enum.includes(text)) throw new ToolInputError(`"${name}" must be one of: ${prop.enum.join(', ')}.`);
        if (text.length < (prop.minLength ?? 1)) throw new ToolInputError(`"${name}" must not be empty.`);
        if (prop.maxLength !== undefined && text.length > prop.maxLength) throw new ToolInputError(`"${name}" is longer than ${prop.maxLength} characters.`);
        // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
        if (/[\u0000-\u001f\u007f]/.test(text)) throw new ToolInputError(`"${name}" contains control characters.`);
        values.set(name, text);
        break;
      }
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) throw new ToolInputError(`"${name}" must be an integer.`);
        if (value < prop.minimum || value > prop.maximum) throw new ToolInputError(`"${name}" must be between ${prop.minimum} and ${prop.maximum}.`);
        values.set(name, value);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') throw new ToolInputError(`"${name}" must be true or false.`);
        values.set(name, value);
        break;
    }
  }
  return new ToolArgs(values);
}
