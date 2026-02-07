/**
 * Tool framework for Neo coding assistant
 */
import { z } from 'zod';

/**
 * Recursively converts string "true"/"false" to actual booleans.
 * Fixes AI models that output booleans as strings in tool arguments.
 */
function coerceStringBooleans<T>(obj: T): T {
  if (obj === 'true') return true as T;
  if (obj === 'false') return false as T;
  if (Array.isArray(obj)) return obj.map(coerceStringBooleans) as T;
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, coerceStringBooleans(v)])
    ) as T;
  }
  return obj;
}

/**
 * Strip undefined and null values from an object.
 * Models sometimes send { filePath: undefined } which Zod rejects.
 */
function stripNullish(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;

  const input = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Converts snake_case keys to camelCase and vice versa.
 * Models often output snake_case (file_path) but our schemas expect camelCase (filePath).
 * This adds aliases so both forms work.
 */
function normalizeParamNames(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;

  const input = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    // Skip undefined/null values
    if (value === undefined || value === null) continue;

    // Keep original key
    result[key] = value;

    // Add camelCase version if the key contains underscores (snake_case → camelCase)
    if (key.includes('_')) {
      const camelCase = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      if (result[camelCase] === undefined) {
        result[camelCase] = value;
      }
    }

    // Add snake_case version if the key is camelCase (camelCase → snake_case)
    const snakeCase = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (snakeCase !== key && result[snakeCase] === undefined) {
      result[snakeCase] = value;
    }
  }

  return result;
}

/**
 * Well-known parameter aliases that models commonly confuse.
 * Maps alternative names → canonical name.
 */
const PARAM_ALIASES: Record<string, Record<string, string>> = {
  read: { path: 'filePath' },
  write: { path: 'filePath' },
  edit: { path: 'filePath' },
  multiedit: { path: 'filePath' },
  read_many_files: { files: 'paths', filePaths: 'paths', file_paths: 'paths' },
};

/**
 * Apply tool-specific parameter aliases.
 */
function applyParamAliases(toolId: string, obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;

  const aliases = PARAM_ALIASES[toolId];
  if (!aliases) return obj;

  const input = obj as Record<string, unknown>;
  const result: Record<string, unknown> = { ...input };

  for (const [alias, canonical] of Object.entries(aliases)) {
    if (result[alias] !== undefined && result[canonical] === undefined) {
      result[canonical] = result[alias];
    }
  }

  return result;
}

export interface ToolContext {
  sessionId: string;
  workspaceDir: string;
  callId: string;
  signal: AbortSignal;
}

/** Attachment for binary content (images, PDFs) returned by tools */
export interface ToolAttachment {
  /** MIME type (e.g. "image/png", "application/pdf") */
  mime: string;
  /** File name */
  name: string;
  /** Base64-encoded data */
  data: string;
}

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  /** Optional binary attachments (images, PDFs) for the model to process */
  attachments?: ToolAttachment[];
}

export interface ToolDefinition<TParams extends z.ZodType = z.ZodType> {
  id: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
}

export function defineTool<TParams extends z.ZodType>(
  id: string,
  config: Omit<ToolDefinition<TParams>, 'id'>
): ToolDefinition<TParams> {
  const originalExecute = config.execute;

  return {
    id,
    description: config.description,
    parameters: config.parameters,
    execute: async (args, ctx) => {
      // 0. Strip undefined/null values
      let cleaned = stripNullish(args);
      // 1. Normalize param names (snake_case ↔ camelCase)
      let normalized = normalizeParamNames(cleaned);
      // 2. Apply tool-specific aliases (e.g. "path" → "filePath" for read)
      normalized = applyParamAliases(id, normalized);
      // 3. Coerce string booleans
      const coerced = coerceStringBooleans(normalized);

      // Debug: log normalized args
      console.log(`[tool:${id}] normalized args:`, JSON.stringify(coerced));

      // 4. Validate with Zod
      const parsed = config.parameters.safeParse(coerced);
      if (!parsed.success) {
        console.error(`[tool:${id}] validation failed:`, parsed.error.issues);
        throw new Error(
          `Invalid arguments for tool ${id}: ${JSON.stringify(parsed.error.issues)}`
        );
      }
      return originalExecute(parsed.data, ctx);
    },
  };
}
