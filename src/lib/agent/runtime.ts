/**
 * Agent runtime for Neo coding assistant
 * Block-based streaming architecture using OpenRouter API
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  OpenRouterClient,
  MODELS,
  type OpenRouterMessage,
  type OpenRouterTool,
  type OpenRouterStreamDelta,
} from '../openrouter';
import { registry } from './registry';
import { registerTools } from './tools';
import { buildSystemPrompt } from './system-prompt';
import { loadMemoryContext, createContextManager, type ContextManager } from '../memory';
import { detectLoop, getLoopSuggestion } from './loop-detection';
import { compressConversation, needsCompression } from './compression';
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

/** Map model types to OpenRouter model IDs */
const MODEL_MAP: Record<ModelType, string> = {
  fast: MODELS.GEMINI_3_FLASH,
  thinking: MODELS.GEMINI_3_PRO,
};

/** Message format for history (OpenRouter compatible) */
export type ChatMessage = OpenRouterMessage;

export class AgentRuntime {
  private client: OpenRouterClient;
  private apiKey: string;
  private workspaceDir: string;
  private sessionId: string;
  private history: ChatMessage[] = [];
  private initialized = false;
  private eventHandler?: AgentEventHandler;
  private memoryContext: string = '';
  private contextManager: ContextManager | null = null;
  private modelType: ModelType = 'fast';

  constructor(apiKey: string, workspaceDir: string, sessionId?: string) {
    this.client = new OpenRouterClient(apiKey, MODEL_MAP['fast']);
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
    
    // Initialize 3-tier context manager
    try {
      this.contextManager = await createContextManager(this.workspaceDir);
    } catch {
      this.contextManager = null;
    }
    
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

  private getToolDefinitions(): OpenRouterTool[] {
    const tools = registry.all();
    return tools.map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.parameters as any, { name: tool.id });
      // Extract the actual schema from zod-to-json-schema output
      const schema = (jsonSchema as any).definitions?.[tool.id] || jsonSchema;
      
      return {
        type: 'function' as const,
        function: {
          name: tool.id,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: schema.properties || {},
            required: schema.required || [],
          },
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
        content: content,
      });

      await this.runLoop(signal);

      this.emit({ type: 'processing_complete' });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'processing_error', error });
    }
  }

  private async runLoop(signal?: AbortSignal) {
    // Build system prompt with 3-tier context
    let contextInstructions = '';
    if (this.contextManager) {
      contextInstructions = this.contextManager.getFullContext();
    }
    
    const systemPrompt = buildSystemPrompt(this.workspaceDir, this.memoryContext, contextInstructions);
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
        (delta: OpenRouterStreamDelta) => {
          if (delta.content) {
            streamedText += delta.content;
            
            // Create or update text block
            if (!textBlockId) {
              textBlockId = `text_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            }
            
            // Emit text block update - UI will merge by ID
            this.emitBlock(createTextBlock(textBlockId, streamedText));
          }
          
          // Surface tool call intent early (as the model streams)
          if (delta.toolCalls) {
            for (const tc of delta.toolCalls) {
              if (tc.id && tc.function.name) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments || '{}');
                } catch {
                  // Arguments still streaming, ignore parse errors
                }
                // Emit tool call block with 'pending' status
                this.emitBlock(createToolCallBlock(
                  `tool_call_${tc.id}`,
                  tc.function.name,
                  args,
                  'pending'
                ));
              }
            }
          }
        },
        signal
      );

      // If no function calls, we're done
      if (result.functionCalls.length === 0) {
        if (streamedText.trim()) {
          this.history.push({
            role: 'assistant',
            content: streamedText,
          });
        }
        return;
      }

      // Process function calls - add assistant message with tool calls
      const toolCalls = result.functionCalls.map((fc) => ({
        id: fc.id,
        type: 'function' as const,
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        },
      }));

      this.history.push({
        role: 'assistant',
        content: streamedText || '',
        tool_calls: toolCalls,
      });

      // Execute tools in parallel where safe
      const toolResponses: ChatMessage[] = [];
      
      // Categorize tools for execution strategy
      const readOnlyTools = new Set(['read', 'ls', 'glob', 'grep', 'read_memory', 'search_memory', 'list_memory', 'list_skills']);
      
      // Separate read-only tools (can run in parallel) from write tools (run sequentially)
      const parallelCalls = result.functionCalls.filter(fc => readOnlyTools.has(fc.name));
      const sequentialCalls = result.functionCalls.filter(fc => !readOnlyTools.has(fc.name));
      
      // Execute read-only tools in parallel
      const parallelPromises = parallelCalls.map(async (fc) => {
        return this.executeToolCall(fc, signal);
      });
      
      const parallelResults = await Promise.all(parallelPromises);
      toolResponses.push(...parallelResults);
      
      // Execute write tools sequentially
      for (const fc of sequentialCalls) {
        const response = await this.executeToolCall(fc, signal);
        toolResponses.push(response);
      }

      // Add tool responses to history
      for (const response of toolResponses) {
        this.history.push(response);
      }

      // Loop detection
      const loopResult = detectLoop(this.history);
      if (loopResult.isLooping) {
        // Inject a hint to break the loop
        const suggestion = getLoopSuggestion(loopResult.loopType || 'tool_repeat');
        this.history.push({
          role: 'user',
          content: `[SYSTEM WARNING] ${loopResult.description}\n\n${suggestion}`,
        });
      }

      // Check for conversation compression
      if (needsCompression(this.history, 30)) {
        try {
          const compressed = await compressConversation(this.history, { apiKey: this.apiKey });
          if (compressed.compressedCount < compressed.originalCount) {
            this.history = compressed.messages;
          }
        } catch {
          // Compression failed, continue with full history
        }
      }
    }

    throw new Error('Max iterations reached');
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(
    fc: { id: string; name: string; args: Record<string, unknown> },
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const tool = registry.get(fc.name);
    const toolCallBlockId = `tool_call_${fc.id}`;
    const toolResultBlockId = `tool_result_${fc.id}`;

    if (!tool) {
      const error = `Tool not found: ${fc.name}`;
      this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'error'));
      this.emitBlock(createToolResultBlock(toolResultBlockId, '', fc.name, 'error', undefined, error));
      return {
        role: 'tool',
        tool_call_id: fc.id,
        content: JSON.stringify({ error }),
      };
    }

    // Update tool call block to executing state
    this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'executing'));

    // Load JIT memory for file access tools
    if (this.contextManager && ['read', 'write', 'edit', 'ls'].includes(fc.name)) {
      const pathArg = (fc.args as { filePath?: string; path?: string }).filePath || 
                      (fc.args as { filePath?: string; path?: string }).path;
      if (pathArg) {
        await this.contextManager.loadJitMemory(pathArg);
      }
    }

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

      this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'completed'));
      this.emitBlock(createToolResultBlock(
        toolResultBlockId,
        toolResult.output,
        fc.name,
        'completed',
        executionTime
      ));

      return {
        role: 'tool',
        tool_call_id: fc.id,
        content: JSON.stringify({ result: toolResult.output }),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const executionTime = Date.now() - startTime;

      this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'error'));
      this.emitBlock(createToolResultBlock(
        toolResultBlockId,
        '',
        fc.name,
        'error',
        executionTime,
        error
      ));

      return {
        role: 'tool',
        tool_call_id: fc.id,
        content: JSON.stringify({ error }),
      };
    }
  }

  clearHistory() {
    this.history = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }
}
