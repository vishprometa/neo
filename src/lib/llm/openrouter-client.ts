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
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { dirname } from '@tauri-apps/api/path';

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

type OpenRouterPdfEngine = 'pdf-text' | 'mistral-ocr' | 'native' | '';

interface OpenRouterFilePart {
  [key: string]: unknown;
  type: 'file';
  file: {
    filename: string;
    file_data: string;
    mimeType: string;
  };
}

interface OpenRouterImagePart {
  [key: string]: unknown;
  type: 'image_url';
  image_url: {
    url: string;
  };
}

function truncate(text: string, maxLen: number) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}... (${text.length} chars total)`;
}

function summarizeContent(content: LLMMessage['content']) {
  if (typeof content === 'string') {
    return truncate(content, 200);
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', preview: truncate(String(part.text ?? ''), 80) };
      }
      if (part.type === 'inline_data') {
        return { type: 'inline_data', mime: part.mime, size: String(part.data ?? '').length };
      }
      if (part.type === 'image_url') {
        return { type: 'image_url' };
      }
      if (part.type === 'file') {
        const file = part.file as { filename?: string; mimeType?: string };
        return { type: 'file', name: file?.filename, mime: file?.mimeType };
      }
      return { type: part.type };
    });
  }
  return '<empty>';
}

function summarizeMessages(messages: LLMMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: summarizeContent(msg.content),
    ...(msg.tool_calls ? { tool_calls: msg.tool_calls.map((tc) => tc.function.name) } : {}),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
  }));
}

async function appendLogLine(logPath: string, line: string) {
  const dir = await dirname(logPath);
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  await writeTextFile(logPath, line, { append: true });
}

/**
 * OpenRouter LLM Client
 */
export class OpenRouterClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private logPath?: string;
  private pdfEngine: OpenRouterPdfEngine;

  constructor(
    apiKey: string,
    model: string = OPENROUTER_MODELS.GEMINI_3_FLASH,
    options?: { logPath?: string; pdfEngine?: OpenRouterPdfEngine }
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.logPath = options?.logPath;
    this.pdfEngine = options?.pdfEngine ?? 'pdf-text';
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

  /**
   * Normalize messages for OpenAI-compatible API.
   * Tool messages must have string content — strip inline_data attachments.
   */
  private normalizeMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages.flatMap((msg) => {
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        // Extract only the text portion from multipart tool responses
        const textPart = msg.content.find((p) => p.type === 'text');
        const toolMessage: LLMMessage = { ...msg, content: textPart?.text || '' };

        const attachmentParts: Array<OpenRouterImagePart | OpenRouterFilePart> = [];
        for (const part of msg.content) {
          if (part.type !== 'inline_data' || !part.mime || !part.data) continue;
          const mime = String(part.mime).toLowerCase();
          const dataUrl = `data:${mime};base64,${String(part.data)}`;

          if (mime.startsWith('image/')) {
            attachmentParts.push({
              type: 'image_url',
              image_url: { url: dataUrl },
            });
          } else if (mime === 'application/pdf') {
            attachmentParts.push({
              type: 'file',
              file: {
                filename: String(part.name || 'document.pdf'),
                file_data: dataUrl,
                mimeType: mime,
              },
            });
          }
        }

        if (attachmentParts.length > 0) {
          const userMessage: LLMMessage = {
            role: 'user',
            content: [
              { type: 'text', text: '[Attached file(s) from tool result for analysis]' },
              ...attachmentParts,
            ],
          };
          return [toolMessage, userMessage];
        }

        return [toolMessage];
      }
      return [msg];
    });
  }

  private buildPlugins(messages: LLMMessage[]): Array<{ id: string; pdf?: { engine?: OpenRouterPdfEngine } }> | undefined {
    const hasPdf = messages.some((msg) => {
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((part) => {
        if (part.type !== 'file') return false;
        const file = part.file as { mimeType?: string; file_data?: string };
        const mime = (file?.mimeType || '').toLowerCase();
        if (mime === 'application/pdf') return true;
        return Boolean(file?.file_data?.startsWith('data:application/pdf'));
      });
    });

    if (!hasPdf) return undefined;
    if (!this.pdfEngine) return undefined;

    return [
      {
        id: 'file-parser',
        pdf: {
          engine: this.pdfEngine,
        },
      },
    ];
  }

  private async logRequest(requestId: string, requestBody: Record<string, unknown>, messages: LLMMessage[]) {
    if (!this.logPath) return;
    const timestamp = new Date().toISOString();
    const entry = {
      type: 'REQUEST',
      requestId,
      timestamp,
      model: requestBody.model,
      max_tokens: requestBody.max_tokens,
      temperature: requestBody.temperature,
      tools: Array.isArray(requestBody.tools) ? requestBody.tools.map((t: any) => t?.function?.name || 'unknown') : undefined,
      messageCount: messages.length,
      messages: summarizeMessages(messages),
    };
    const line = `[${timestamp}] REQUEST ${requestId}\n${JSON.stringify(entry, null, 2)}\n${'='.repeat(80)}\n`;
    try {
      await appendLogLine(this.logPath, line);
    } catch {
      // ignore logging errors
    }
  }

  async streamChat(
    systemInstruction: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    onDelta: (delta: LLMStreamDelta) => void,
    signal?: AbortSignal
  ): Promise<LLMChatResult> {
    const fullMessages: LLMMessage[] = this.normalizeMessages([
      { role: 'system', content: systemInstruction },
      ...messages,
    ]);
    const plugins = this.buildPlugins(fullMessages);

    const requestBody = {
      model: this.model,
      messages: fullMessages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      plugins,
      stream: true,
      max_tokens: 16384,
      temperature: 0.2,
    };
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.logRequest(requestId, requestBody, fullMessages);

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
    const fullMessages: LLMMessage[] = this.normalizeMessages([
      { role: 'system', content: systemInstruction },
      ...messages,
    ]);
    const plugins = this.buildPlugins(fullMessages);

    const requestBody = {
      model: this.model,
      messages: fullMessages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      plugins,
      stream: false,
      max_tokens: 16384,
      temperature: 0.2,
    };
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.logRequest(requestId, requestBody, fullMessages);

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
        { role: 'system' as const, content: systemInstruction },
        { role: 'user' as const, content: prompt },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature: 0.2,
    };
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.logRequest(requestId, requestBody, requestBody.messages as LLMMessage[]);

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
