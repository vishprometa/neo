/**
 * Gemini client for Neo - uses Google's GenAI SDK directly
 * Implements the unified LLMClient interface
 */
import {
  GoogleGenAI,
  Type,
  type Content,
  type Part,
  type Tool as GeminiTool,
  FunctionCallingConfigMode,
} from '@google/genai';
import type {
  LLMClient,
  LLMMessage,
  LLMTool,
  LLMStreamDelta,
  LLMChatResult,
  LLMFunctionCall,
  LLMProvider,
} from './types';

/** Gemini model IDs */
export const GEMINI_MODELS = {
  FAST: 'gemini-2.5-flash',
  THINKING: 'gemini-2.5-pro',
  FLASH_LITE: 'gemini-2.0-flash-lite',
  FLASH: 'gemini-2.0-flash',
} as const;

/**
 * Convert LLMMessage to Gemini Content format
 */
function toGeminiContent(messages: LLMMessage[]): Content[] {
  const contents: Content[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      // System messages are handled separately in Gemini
      continue;
    }
    
    const parts: Part[] = [];
    
    // Handle content
    if (typeof msg.content === 'string') {
      if (msg.content) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item.text) {
          parts.push({ text: item.text });
        }
      }
    }
    
    // Handle tool calls (assistant message)
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        parts.push({
          functionCall: {
            name: tc.function.name,
            args,
          },
        });
      }
    }
    
    // Handle tool response
    if (msg.role === 'tool' && msg.tool_call_id) {
      let response: Record<string, unknown> = {};
      try {
        response = typeof msg.content === 'string' ? JSON.parse(msg.content) : {};
      } catch {
        response = { result: msg.content };
      }
      parts.push({
        functionResponse: {
          name: msg.tool_call_id, // We'll need to track tool names separately
          response,
        },
      });
    }
    
    if (parts.length > 0) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      });
    }
  }
  
  return contents;
}

/**
 * Convert LLMTool to Gemini tool format
 */
function toGeminiTools(tools: LLMTool[]): GeminiTool[] {
  if (tools.length === 0) return [];
  
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: {
        type: Type.OBJECT,
        properties: (tool.function.parameters as any).properties || {},
        required: (tool.function.parameters as any).required || [],
      },
    })),
  }];
}

/**
 * Gemini LLM Client
 */
export class GeminiClient implements LLMClient {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = GEMINI_MODELS.FAST) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  getProvider(): LLMProvider {
    return 'gemini';
  }

  async streamChat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    onDelta: (delta: LLMStreamDelta) => void,
    signal?: AbortSignal
  ): Promise<LLMChatResult> {
    const contents = toGeminiContent(messages);
    const geminiTools = toGeminiTools(tools);

    const response = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
        toolConfig: tools.length > 0 ? {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        } : undefined,
        abortSignal: signal,
      },
    });

    let fullText = '';
    const functionCalls: LLMFunctionCall[] = [];
    let finishReason = '';
    let callIndex = 0;

    for await (const chunk of response) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      if (candidate.finishReason) {
        finishReason = candidate.finishReason;
      }

      const content = candidate.content;
      if (!content?.parts) continue;

      for (const part of content.parts) {
        if (part.text) {
          fullText += part.text;
          onDelta({ content: part.text });
        }
        if (part.functionCall) {
          const fc: LLMFunctionCall = {
            id: `call_${Date.now()}_${callIndex++}`,
            name: part.functionCall.name || '',
            args: (part.functionCall.args as Record<string, unknown>) || {},
          };
          functionCalls.push(fc);
          onDelta({
            toolCalls: [{
              id: fc.id,
              type: 'function',
              function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args),
              },
            }],
          });
        }
      }
    }

    return { text: fullText, functionCalls, finishReason };
  }

  async chat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools: LLMTool[] = []
  ): Promise<LLMChatResult> {
    const contents = toGeminiContent(messages);
    const geminiTools = toGeminiTools(tools);

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
        toolConfig: tools.length > 0 ? {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        } : undefined,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      return { text: '', functionCalls: [] };
    }

    let text = '';
    const functionCalls: LLMFunctionCall[] = [];
    let callIndex = 0;

    for (const part of candidate.content.parts) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        functionCalls.push({
          id: `call_${Date.now()}_${callIndex++}`,
          name: part.functionCall.name || '',
          args: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }

    return { text, functionCalls, finishReason: candidate.finishReason };
  }

  async complete(
    systemInstruction: string,
    prompt: string,
    maxTokens: number = 4096
  ): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        maxOutputTokens: maxTokens,
      },
    });

    return response.text || '';
  }
}

/**
 * Validate a Gemini API key
 */
export async function validateGeminiApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new GoogleGenAI({ apiKey });
    await client.models.generateContent({
      model: GEMINI_MODELS.FLASH_LITE,
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
    });
    return true;
  } catch {
    return false;
  }
}
