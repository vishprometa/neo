/**
 * Agent runtime for Neo coding assistant
 * Block-based streaming architecture inspired by erpai-cli
 */
import type { Part, FunctionDeclaration, Type } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GeminiClient, type GeminiMessage, type StreamDelta } from '../gemini/client';
import { registry } from './registry';
import { registerTools } from './tools';
import { buildSystemPrompt } from './system-prompt';
import { loadMemoryContext } from '../memory';
// ToolContext types are re-exported from ./types
import type {
  AgentEvent,
  AgentEventHandler,
  ContentBlock,
  ExtendedToolContext,
} from './types';
import {
  createTextBlock,
  createToolCallBlock,
  createToolResultBlock,
} from './types';

// Re-export types
export type { AgentEvent, AgentEventHandler } from './types';

export type ModelType = 'fast' | 'thinking';

const MODEL_MAP: Record<ModelType, string> = {
  fast: 'gemini-2.5-flash',
  thinking: 'gemini-2.5-pro',
};

export class AgentRuntime {
  private client: GeminiClient;
  private apiKey: string;
  private workspaceDir: string;
  private sessionId: string;
  private history: GeminiMessage[] = [];
  private initialized = false;
  private eventHandler?: AgentEventHandler;
  private memoryContext: string = '';
  private modelType: ModelType = 'fast';

  constructor(apiKey: string, workspaceDir: string, sessionId?: string) {
    this.client = new GeminiClient(apiKey, MODEL_MAP['fast']);
    this.apiKey = apiKey;
    this.workspaceDir = workspaceDir;
    this.sessionId = sessionId || `session_${Date.now()}`;
  }

  setModelType(modelType: ModelType) {
    this.modelType = modelType;
    this.client.setModel(MODEL_MAP[modelType]);
  }

  getModelType(): ModelType {
    return this.modelType;
  }

  setEventHandler(handler: AgentEventHandler) {
    this.eventHandler = handler;
  }

  private emit(event: AgentEvent) {
    this.eventHandler?.(event);
  }

  private emitBlock(block: ContentBlock) {
    this.emit({ type: 'content_block_update', block });
  }

  async initialize() {
    if (this.initialized) return;
    registerTools();
    
    // Load memory context if available
    try {
      this.memoryContext = await loadMemoryContext(this.workspaceDir);
    } catch {
      this.memoryContext = '';
    }
    
    this.initialized = true;
  }

  /** Reload memory context (call after sync) */
  async reloadMemory() {
    try {
      this.memoryContext = await loadMemoryContext(this.workspaceDir);
    } catch {
      this.memoryContext = '';
    }
  }

  private getToolDefinitions(): FunctionDeclaration[] {
    const tools = registry.all();
    return tools.map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.parameters as any, { name: tool.id });
      // Extract the actual schema from zod-to-json-schema output
      const schema = (jsonSchema as any).definitions?.[tool.id] || jsonSchema;
      
      return {
        name: tool.id,
        description: tool.description,
        parameters: {
          type: 'OBJECT' as Type,
          properties: schema.properties || {},
          required: schema.required || [],
        },
      };
    });
  }

  async sendMessage(content: string, signal?: AbortSignal): Promise<void> {
    await this.initialize();
    this.emit({ type: 'processing_start' });

    try {
      // Add user message to history
      this.history.push({
        role: 'user',
        parts: [{ text: content }],
      });

      await this.runLoop(signal);

      this.emit({ type: 'processing_complete' });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'processing_error', error });
    }
  }

  private async runLoop(signal?: AbortSignal) {
    const systemPrompt = buildSystemPrompt(this.workspaceDir, this.memoryContext);
    const tools = this.getToolDefinitions();
    const maxIterations = 20; // Prevent infinite loops

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }

      let streamedText = '';
      let textBlockId: string | null = null;

      const result = await this.client.streamChat(
        systemPrompt,
        this.history,
        tools,
        (delta: StreamDelta) => {
          if (delta.text) {
            streamedText += delta.text;
            
            // Create or update text block
            if (!textBlockId) {
              textBlockId = `text_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            }
            
            // Emit text block update - UI will merge by ID
            this.emitBlock(createTextBlock(textBlockId, streamedText));
          }
          
          // Surface tool call intent early (as the model streams)
          if (delta.functionCalls) {
            for (const fc of delta.functionCalls) {
              // Emit tool call block with 'pending' status
              this.emitBlock(createToolCallBlock(
                `tool_call_${fc.id}`,
                fc.name,
                fc.args,
                'pending'
              ));
            }
          }
        },
        signal
      );

      // If no function calls, we're done
      if (result.functionCalls.length === 0) {
        if (streamedText.trim()) {
          this.history.push({
            role: 'model',
            parts: [{ text: streamedText }],
          });
        }
        return;
      }

      // Process function calls
      const modelParts: Part[] = [];
      if (streamedText.trim()) {
        modelParts.push({ text: streamedText });
      }
      
      for (const fc of result.functionCalls) {
        modelParts.push({
          functionCall: {
            name: fc.name,
            args: fc.args,
          },
        });
      }
      
      this.history.push({
        role: 'model',
        parts: modelParts,
      });

      // Execute tools and collect responses
      const responseParts: Part[] = [];
      
      for (const fc of result.functionCalls) {
        const tool = registry.get(fc.name);
        const toolCallBlockId = `tool_call_${fc.id}`;
        const toolResultBlockId = `tool_result_${fc.id}`;
        
        if (!tool) {
          const error = `Tool not found: ${fc.name}`;
          
          // Update tool call block to error state
          this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'error'));
          this.emitBlock(createToolResultBlock(toolResultBlockId, '', fc.name, 'error', undefined, error));
          
          responseParts.push({
            functionResponse: {
              name: fc.name,
              response: { error },
            },
          });
          continue;
        }

        // Update tool call block to executing state
        this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'executing'));

        const ctx: ExtendedToolContext = {
          sessionId: this.sessionId,
          workspaceDir: this.workspaceDir,
          callId: fc.id,
          signal: signal || new AbortController().signal,
          apiKey: this.apiKey,
        };

        const startTime = Date.now();
        
        try {
          const toolResult = await tool.execute(fc.args, ctx);
          const executionTime = Date.now() - startTime;
          
          // Update tool call block to completed state
          this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'completed'));
          
          // Emit tool result block
          this.emitBlock(createToolResultBlock(
            toolResultBlockId,
            toolResult.output,
            fc.name,
            'completed',
            executionTime
          ));
          
          responseParts.push({
            functionResponse: {
              name: fc.name,
              response: { result: toolResult.output },
            },
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          const executionTime = Date.now() - startTime;
          
          // Update tool call block to error state
          this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'error'));
          
          // Emit tool result block with error
          this.emitBlock(createToolResultBlock(
            toolResultBlockId,
            '',
            fc.name,
            'error',
            executionTime,
            error
          ));
          
          responseParts.push({
            functionResponse: {
              name: fc.name,
              response: { error },
            },
          });
        }
      }

      // Add tool responses to history
      this.history.push({
        role: 'user',
        parts: responseParts,
      });
    }

    throw new Error('Max iterations reached');
  }

  clearHistory() {
    this.history = [];
  }

  getHistory(): GeminiMessage[] {
    return [...this.history];
  }
}
