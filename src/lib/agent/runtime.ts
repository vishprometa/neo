/**
 * Agent runtime for Neo coding assistant
 * Block-based streaming architecture using unified LLM interface
 * Supports both Gemini (direct) and OpenRouter providers
 */
import { z } from 'zod';
import {
  createClient,
  type LLMClient,
  type LLMMessage,
  type LLMTool,
  type LLMStreamDelta,
  type ProviderConfig,
  type ModelType,
} from '../llm';
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
export type { ModelType };

/** Message format for history (OpenAI/OpenRouter compatible) */
export type ChatMessage = LLMMessage;

const MAX_TOOL_RESULT_SIZE = 30_000; // 30KB cap per tool result in history
const RETRYABLE_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', 'network'];
const MAX_RETRIES = 2;

/** Check if an error is transient and worth retrying */
function isRetryableError(error: string): boolean {
  const lower = error.toLowerCase();
  return RETRYABLE_ERRORS.some(pattern => lower.includes(pattern.toLowerCase()));
}

/** Truncate a tool result string if it exceeds the size cap */
function truncateToolResult(content: string, maxSize: number = MAX_TOOL_RESULT_SIZE): string {
  if (content.length <= maxSize) return content;
  return content.slice(0, maxSize) + '\n\n... (output truncated to save context)';
}

export class AgentRuntime {
  private client: LLMClient;
  private providerConfig: ProviderConfig;
  private workspaceDir: string;
  private sessionId: string;
  private history: ChatMessage[] = [];
  private initialized = false;
  private eventHandler?: AgentEventHandler;
  private memoryContext: string = '';
  private contextManager: ContextManager | null = null;
  private modelType: ModelType = 'fast';

  constructor(providerConfig: ProviderConfig, workspaceDir: string, sessionId?: string) {
    const normalizedWorkspaceDir = workspaceDir.replace(/\/$/, '');
    const logPath = `${normalizedWorkspaceDir}/openrouter.log`;
    const enhancedConfig = providerConfig.provider === 'openrouter'
      ? {
          ...providerConfig,
          logPath: providerConfig.logPath ?? logPath,
          openrouterPdfEngine: providerConfig.openrouterPdfEngine ?? 'pdf-text',
        }
      : providerConfig;

    this.client = createClient(enhancedConfig, 'fast');
    this.providerConfig = enhancedConfig;
    this.workspaceDir = workspaceDir;
    this.sessionId = sessionId || `session_${Date.now()}`;
  }

  setModelType(modelType: ModelType) {
    this.modelType = modelType;
    // Re-create client with new model type
    this.client = createClient(this.providerConfig, modelType);
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

  private getToolDefinitions(): LLMTool[] {
    const tools = registry.all();
    return tools.map((tool) => {
      // Use Zod v4's built-in JSON Schema conversion (zod-to-json-schema doesn't support v4)
      const schema = z.toJSONSchema(tool.parameters);

      return {
        type: 'function' as const,
        function: {
          name: tool.id,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: (schema as any).properties || {},
            required: (schema as any).required || [],
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
    const maxIterations = 40; // Allow enough iterations for multi-step task lists

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
        (delta: LLMStreamDelta) => {
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
      const readOnlyTools = new Set([
        'read', 'read_file', 'read_many_files', 'ls', 'glob', 'grep',
        'read_memory', 'search_memory', 'list_memory', 'get_memory_context',
        'list_skills', 'todoread', 'web_fetch', 'web_search', 'question',
      ]);
      
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
          const compressed = await compressConversation(this.history, this.providerConfig);
          if (compressed.compressedCount < compressed.originalCount) {
            this.history = compressed.messages;
          }
        } catch {
          // Compression failed, continue with full history
        }
      }
    }

    // Gracefully handle max iterations - tell the model to wrap up
    this.history.push({
      role: 'user',
      content: '[SYSTEM] You have reached the maximum number of tool call iterations (40). Please provide a final summary of what was accomplished and what remains to be done. Update the todo list with final statuses.',
    });

    // One final LLM call to generate a summary response (no tools)
    try {
      let finalText = '';
      let finalBlockId: string | null = null;
      await this.client.streamChat(
        systemPrompt,
        this.history,
        [], // no tools - force a text response
        (delta: LLMStreamDelta) => {
          if (delta.content) {
            finalText += delta.content;
            if (!finalBlockId) {
              finalBlockId = `text_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            }
            this.emitBlock(createTextBlock(finalBlockId, finalText));
          }
        },
        signal
      );
      if (finalText.trim()) {
        this.history.push({ role: 'assistant', content: finalText });
      }
    } catch {
      // If even the summary fails, just stop
    }
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(
    fc: { id: string; name: string; args: Record<string, unknown> },
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    // Debug: log raw tool call from the model
    console.log(`[tool:${fc.name}] raw args from model:`, JSON.stringify(fc.args, null, 2));

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
    if (this.contextManager && ['read', 'read_many_files', 'write', 'edit', 'multiedit', 'replace', 'ls'].includes(fc.name)) {
      const pathArg = (fc.args as { filePath?: string; path?: string; file_path?: string }).filePath
        || (fc.args as { filePath?: string; path?: string; file_path?: string }).path
        || (fc.args as { filePath?: string; path?: string; file_path?: string }).file_path;
      if (pathArg) {
        await this.contextManager.loadJitMemory(pathArg);
      }
    }

    const ctx: ExtendedToolContext = {
      sessionId: this.sessionId,
      workspaceDir: this.workspaceDir,
      callId: fc.id,
      signal: signal || new AbortController().signal,
      apiKey: this.providerConfig.apiKey,
      provider: this.providerConfig.provider,
    };

    const startTime = Date.now();
    let lastError = '';

    // Retry loop for transient errors
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const toolResult = await tool.execute(fc.args, ctx);
        const executionTime = Date.now() - startTime;

        this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'completed'));
        this.emitBlock(createToolResultBlock(
          toolResultBlockId,
          toolResult.output,
          fc.name,
          'completed',
          executionTime,
          undefined,
          toolResult.metadata
        ));

        // If the tool returned attachments (images, PDFs), include them as
        // multipart content so the LLM can see the binary data.
        if (toolResult.attachments && toolResult.attachments.length > 0) {
          const parts: Array<{ type: string; text?: string; [key: string]: unknown }> = [
            { type: 'text', text: truncateToolResult(JSON.stringify({ result: toolResult.output })) },
          ];
          for (const att of toolResult.attachments) {
            parts.push({
              type: 'inline_data',
              mime: att.mime,
              name: att.name,
              data: att.data,
            });
          }
          return {
            role: 'tool',
            tool_call_id: fc.id,
            content: parts,
          };
        }

        return {
          role: 'tool',
          tool_call_id: fc.id,
          content: truncateToolResult(JSON.stringify({ result: toolResult.output })),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        // Only retry transient errors, and not on the last attempt
        if (attempt < MAX_RETRIES && isRetryableError(lastError)) {
          const delay = Math.pow(2, attempt) * 500; // 500ms, 1000ms
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        break;
      }
    }

    // All attempts failed
    const executionTime = Date.now() - startTime;
    this.emitBlock(createToolCallBlock(toolCallBlockId, fc.name, fc.args, 'error'));
    this.emitBlock(createToolResultBlock(
      toolResultBlockId,
      '',
      fc.name,
      'error',
      executionTime,
      lastError
    ));

    return {
      role: 'tool',
      tool_call_id: fc.id,
      content: JSON.stringify({ error: lastError }),
    };
  }

  clearHistory() {
    this.history = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }
}
