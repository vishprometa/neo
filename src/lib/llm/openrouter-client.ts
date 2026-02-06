/**
 * OpenRouter client for Neo
 * Implements the unified LLMClient interface
 */
import type {
  LLMClient,
  LLMMessage,
  LLMTool,
  LLMStreamDelta,
  LLMChatResult,
  LLMFunctionCall,
  LLMProvider,
} from './types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** OpenRouter model IDs for Google Gemini models */
export const OPENROUTER_MODELS = {
  // Main chat models
  GEMINI_3_FLASH: 'google/gemini-3-flash-preview',
  GEMINI_3_PRO: 'google/gemini-3-pro-preview',
  // Utility models
  GEMINI_2_5_FLASH: 'google/gemini-2.5-flash',
  GEMINI_2_5_FLASH_LITE: 'google/gemini-2.5-flash-lite',
} as const;

interface StreamChunkDelta {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface StreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: StreamChunkDelta;
    finish_reason?: string;
  }>;
}

interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

interface StreamAccumulator {
  content: string;
  reasoning: string;
  toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/**
 * OpenRouter LLM Client
 */
export class OpenRouterClient implements LLMClient {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = OPENROUTER_MODELS.GEMINI_3_FLASH) {
    this.apiKey = apiKey;
    this.model = model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  getProvider(): LLMProvider {
    return 'openrouter';
  }

  async streamChat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    onDelta: (delta: LLMStreamDelta) => void,
    signal?: AbortSignal
  ): Promise<LLMChatResult> {
    const fullMessages: LLMMessage[] = [
      { role: 'system', content: systemInstruction },
      ...messages,
    ];

    const requestBody = {
      model: this.model,
      messages: fullMessages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: true,
      max_tokens: 16384,
      temperature: 0.2,
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neo.local',
        'X-Title': 'Neo Coding Assistant',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const { acc, finishReason } = await this.parseSseStream(response, onDelta);

    const functionCalls: LLMFunctionCall[] = acc.toolCalls.map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      return {
        id: tc.id,
        name: tc.function.name,
        args,
      };
    });

    return {
      text: acc.content,
      functionCalls,
      finishReason,
    };
  }

  async chat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools: LLMTool[] = []
  ): Promise<LLMChatResult> {
    const fullMessages: LLMMessage[] = [
      { role: 'system', content: systemInstruction },
      ...messages,
    ];

    const requestBody = {
      model: this.model,
      messages: fullMessages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: false,
      max_tokens: 16384,
      temperature: 0.2,
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neo.local',
        'X-Title': 'Neo Coding Assistant',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = (await response.json()) as ChatResponse;
    const choice = result.choices?.[0];

    if (!choice) {
      return { text: '', functionCalls: [] };
    }

    const functionCalls: LLMFunctionCall[] = (choice.message.tool_calls || []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      return {
        id: tc.id,
        name: tc.function.name,
        args,
      };
    });

    return {
      text: choice.message.content || '',
      functionCalls,
      finishReason: choice.finish_reason,
    };
  }

  async complete(
    systemInstruction: string,
    prompt: string,
    maxTokens: number = 4096
  ): Promise<string> {
    const requestBody = {
      model: this.model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature: 0.2,
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neo.local',
        'X-Title': 'Neo Coding Assistant',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = (await response.json()) as ChatResponse;
    return result.choices?.[0]?.message?.content || '';
  }

  private async parseSseStream(
    response: Response,
    onDelta: (delta: LLMStreamDelta) => void
  ): Promise<{ acc: StreamAccumulator; finishReason: string }> {
    if (!response.body) {
      throw new Error('OpenRouter API error: empty stream response');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const acc: StreamAccumulator = { content: '', reasoning: '', toolCalls: [] };
    let finishReason = '';

    const reader = response.body.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            if (data === '[DONE]') {
              return { acc, finishReason };
            }

            let payload: StreamChunk;
            try {
              payload = JSON.parse(data) as StreamChunk;
            } catch {
              continue;
            }

            const choice = payload.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            const reasoningDelta = delta.reasoning || delta.reasoning_content;
            if (reasoningDelta) {
              acc.reasoning += reasoningDelta;
              onDelta({ reasoning: reasoningDelta });
            }

            if (delta.content) {
              acc.content += delta.content;
              onDelta({ content: delta.content });
            }

            if (delta.tool_calls) {
              this.applyToolCallDeltas(acc, delta.tool_calls);
              onDelta({ toolCalls: acc.toolCalls });
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    return { acc, finishReason };
  }

  private applyToolCallDeltas(
    acc: StreamAccumulator,
    deltas: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>
  ) {
    for (const delta of deltas) {
      const idx = delta.index;

      while (acc.toolCalls.length <= idx) {
        acc.toolCalls.push({
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        });
      }

      const tc = acc.toolCalls[idx];

      if (delta.id) tc.id = delta.id;
      if (delta.type) tc.type = delta.type;
      if (delta.function?.name) tc.function.name += delta.function.name;
      if (delta.function?.arguments) tc.function.arguments += delta.function.arguments;
    }
  }
}

/**
 * Validate an OpenRouter API key
 */
export async function validateOpenRouterApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neo.local',
        'X-Title': 'Neo Coding Assistant',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODELS.GEMINI_2_5_FLASH_LITE,
        messages: [{ role: 'user', content: 'Reply with OK' }],
        max_tokens: 10,
        stream: false,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
