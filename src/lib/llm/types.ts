/**
 * Unified LLM provider types for Neo
 * Supports both Gemini (direct) and OpenRouter
 */

/** Supported LLM providers */
export type LLMProvider = 'gemini' | 'openrouter';

/** Provider configuration */
export interface ProviderConfig {
  provider: LLMProvider;
  apiKey: string;
  /**
   * Optional OpenRouter request logging path.
   * If set, requests are appended to this file.
   */
  logPath?: string;
  /**
   * Optional OpenRouter PDF engine configuration.
   * When set, enables the OpenRouter file-parser plugin for PDFs.
   */
  openrouterPdfEngine?: 'pdf-text' | 'mistral-ocr' | 'native' | '';
}

/** Message format (OpenAI-compatible) */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** Tool/function definition */
export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Streaming delta */
export interface LLMStreamDelta {
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/** Function call result */
export interface LLMFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Chat completion result */
export interface LLMChatResult {
  text: string;
  functionCalls: LLMFunctionCall[];
  finishReason?: string;
}

/** Model type shortcuts */
export type ModelType = 'fast' | 'thinking';

/** LLM Client interface - both providers implement this */
export interface LLMClient {
  /** Set the current model */
  setModel(model: string): void;
  
  /** Get the current model */
  getModel(): string;
  
  /** Get the provider name */
  getProvider(): LLMProvider;
  
  /** Streaming chat completion */
  streamChat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    onDelta: (delta: LLMStreamDelta) => void,
    signal?: AbortSignal
  ): Promise<LLMChatResult>;
  
  /** Non-streaming chat completion */
  chat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools?: LLMTool[]
  ): Promise<LLMChatResult>;
  
  /** Simple text completion */
  complete(
    systemInstruction: string,
    prompt: string,
    maxTokens?: number
  ): Promise<string>;
}

/** Factory function type */
export type LLMClientFactory = (config: ProviderConfig, modelType?: ModelType) => LLMClient;
