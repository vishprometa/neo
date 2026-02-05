/**
 * Tool registry for Neo coding assistant
 */
import type { ToolDefinition } from './tool';

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition) {
    if (this.tools.has(tool.id)) {
      console.warn(`Tool ${tool.id} already registered, skipping`);
      return;
    }
    this.tools.set(tool.id, tool);
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  ids(): string[] {
    return [...this.tools.keys()];
  }
}

export const registry = new ToolRegistry();
