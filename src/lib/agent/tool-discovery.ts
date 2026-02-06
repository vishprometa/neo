/**
 * Tool discovery service for Neo
 * Discovers and registers tools from the workspace
 * Inspired by gemini-cli's tool discovery system
 */

import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { z } from 'zod';
import { defineTool, type ToolDefinition } from './tool';
import { registry } from './registry';

export interface DiscoveredTool {
  name: string;
  description: string;
  command: string;
  parameters?: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
  source: string;
}

export interface ToolDiscoveryConfig {
  /** Directories to search for tool definitions */
  searchDirs?: string[];
  /** File names to look for tool definitions */
  toolFileNames?: string[];
}

const DEFAULT_SEARCH_DIRS = ['.neo/tools', 'tools', '.tools'];
const DEFAULT_TOOL_FILE_NAMES = ['tools.json', 'TOOLS.json', 'tools.yaml', 'TOOLS.yaml'];

/**
 * Parse a tools definition file
 */
async function parseToolsFile(filePath: string): Promise<DiscoveredTool[]> {
  try {
    const content = await readTextFile(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase();

    if (ext === 'json') {
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        return data.map((tool) => ({
          ...tool,
          source: filePath,
        }));
      } else if (data.tools && Array.isArray(data.tools)) {
        return data.tools.map((tool: DiscoveredTool) => ({
          ...tool,
          source: filePath,
        }));
      }
    }

    // YAML support would require a yaml parser library
    // For now, only JSON is supported

    return [];
  } catch {
    return [];
  }
}

/**
 * Create a tool definition from a discovered tool
 */
function createToolFromDiscovered(discovered: DiscoveredTool): ToolDefinition | null {
  try {
    // Build parameters schema from discovered tool
    const paramSchema: Record<string, z.ZodType> = {};

    if (discovered.parameters) {
      for (const [key, param] of Object.entries(discovered.parameters)) {
        let schema: z.ZodType;

        switch (param.type) {
          case 'string':
            schema = z.string().describe(param.description);
            break;
          case 'number':
            schema = z.coerce.number().describe(param.description);
            break;
          case 'boolean':
            schema = z.coerce.boolean().describe(param.description);
            break;
          case 'array':
            schema = z.array(z.string()).describe(param.description);
            break;
          default:
            schema = z.string().describe(param.description);
        }

        if (!param.required) {
          schema = schema.optional();
        }

        paramSchema[key] = schema;
      }
    }

    // Always add a command parameter for custom tools
    const parameters = z.object({
      ...paramSchema,
      // Arguments passed to the command
      args: z.string().optional().describe('Additional arguments'),
    });

    return defineTool(discovered.name, {
      description: `${discovered.description}\n\n[Custom tool from: ${discovered.source}]`,
      parameters,
      async execute(params, ctx) {
        // Execute the command with parameters
        // This is a placeholder - actual implementation would use shell execution
        let command = discovered.command;

        // Replace parameter placeholders
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) {
            command = command.replace(`{{${key}}}`, String(value));
          }
        }

        // For safety, custom tool execution should be handled by the shell tool
        // Return the command that would be executed
        return {
          title: `Custom: ${discovered.name}`,
          output: `Command to execute: ${command}\n\nTo run this, use the shell tool with this command.`,
          metadata: {
            command,
            source: discovered.source,
          },
        };
      },
    });
  } catch {
    return null;
  }
}

/**
 * Discover tools in a workspace
 */
export async function discoverTools(
  workspaceDir: string,
  config: ToolDiscoveryConfig = {}
): Promise<DiscoveredTool[]> {
  const searchDirs = config.searchDirs || DEFAULT_SEARCH_DIRS;
  const toolFileNames = config.toolFileNames || DEFAULT_TOOL_FILE_NAMES;
  const discovered: DiscoveredTool[] = [];

  for (const searchDir of searchDirs) {
    const dirPath = await join(workspaceDir, searchDir);

    if (!(await exists(dirPath))) {
      continue;
    }

    // Check for tool definition files
    for (const fileName of toolFileNames) {
      const filePath = await join(dirPath, fileName);
      if (await exists(filePath)) {
        const tools = await parseToolsFile(filePath);
        discovered.push(...tools);
      }
    }

    // Also scan for individual tool files
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        if (entry.name.endsWith('.tool.json')) {
          const filePath = await join(dirPath, entry.name);
          const tools = await parseToolsFile(filePath);
          discovered.push(...tools);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return discovered;
}

/**
 * Register discovered tools with the registry
 */
export async function registerDiscoveredTools(
  workspaceDir: string,
  config: ToolDiscoveryConfig = {}
): Promise<string[]> {
  const discovered = await discoverTools(workspaceDir, config);
  const registered: string[] = [];

  for (const tool of discovered) {
    // Skip if a tool with this name already exists
    if (registry.get(tool.name)) {
      continue;
    }

    const toolDef = createToolFromDiscovered(tool);
    if (toolDef) {
      registry.register(toolDef);
      registered.push(tool.name);
    }
  }

  return registered;
}

/**
 * List available discovered tools without registering them
 */
export async function listDiscoveredTools(
  workspaceDir: string,
  config: ToolDiscoveryConfig = {}
): Promise<Array<{ name: string; description: string; source: string }>> {
  const discovered = await discoverTools(workspaceDir, config);

  return discovered.map((tool) => ({
    name: tool.name,
    description: tool.description,
    source: tool.source,
  }));
}
