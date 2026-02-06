/**
 * Block-based message types for Neo
 * Inspired by erpai-cli's streaming architecture
 */

// Content block types
export type BlockFormat = 
  | 'text' 
  | 'reasoning' 
  | 'tool_call' 
  | 'tool_result' 
  | 'error';

export interface ContentBlock {
  id: string;
  format: BlockFormat;
  content: unknown;
  metadata?: Record<string, unknown>;
  subtitle?: string;
}

// Text block content
export interface TextBlockContent {
  text: string;
}

// Reasoning block content (for thinking models)
export interface ReasoningBlockContent {
  text: string;
}

// Tool call block content
export interface ToolCallBlockContent {
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'error';
}

// Tool result block content
export interface ToolResultBlockContent {
  output: string;
  executionTime?: number;
  error?: string;
}

// Message types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text?: string;
  blocks?: ContentBlock[];
  timestamp: number;
}

// Session status
export type SessionStatus = 'idle' | 'processing' | 'error';

// Agent events - unified event system
export type AgentEvent =
  | { type: 'processing_start' }
  | { type: 'processing_complete' }
  | { type: 'processing_error'; error: string }
  | { type: 'content_block_update'; block: ContentBlock }
  | { type: 'token_usage'; usage: TokenUsage };

export type AgentEventHandler = (event: AgentEvent) => void;

// Token usage tracking
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Tool execution context
export interface ToolContext {
  sessionId: string;
  workspaceDir: string;
  callId: string;
  signal: AbortSignal;
}

// Extended tool context with provider config for memory tools
export interface ExtendedToolContext extends ToolContext {
  apiKey: string;
  provider: 'gemini' | 'openrouter';
}

// Tool result
export interface ToolResult {
  output: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

// Block helper functions
export function createTextBlock(id: string, text: string): ContentBlock {
  return {
    id,
    format: 'text',
    content: text,
  };
}

export function createReasoningBlock(id: string, text: string): ContentBlock {
  return {
    id,
    format: 'reasoning',
    content: text,
  };
}

export function createToolCallBlock(
  id: string, 
  name: string, 
  args: Record<string, unknown>,
  status: 'pending' | 'executing' | 'completed' | 'error' = 'pending'
): ContentBlock {
  return {
    id,
    format: 'tool_call',
    content: { name, args, status },
    metadata: { tool: name, status },
  };
}

export function createToolResultBlock(
  id: string,
  output: string,
  toolName: string,
  status: 'completed' | 'error',
  executionTime?: number,
  error?: string
): ContentBlock {
  return {
    id,
    format: 'tool_result',
    content: { output, executionTime, error },
    metadata: { tool: toolName, status, execution_time: executionTime },
  };
}

export function createErrorBlock(id: string, error: string): ContentBlock {
  return {
    id,
    format: 'error',
    content: error,
  };
}
