/**
 * Tool framework for Neo coding assistant
 */
import { z } from 'zod';

/**
 * Recursively converts string "true"/"false" to actual booleans.
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

export interface ToolContext {
  sessionId: string;
  workspaceDir: string;
  callId: string;
  signal: AbortSignal;
}

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
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
      const coercedArgs = coerceStringBooleans(args);
      const parsed = config.parameters.safeParse(coercedArgs);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for tool ${id}: ${parsed.error.message}`
        );
      }
      return originalExecute(parsed.data, ctx);
    },
  };
}
