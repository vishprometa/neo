/**
 * Minimal Gemini client for Neo coding assistant
 */
import {
  GoogleGenAI,
  type Content,
  type Part,
  type Tool as GeminiTool,
  type FunctionDeclaration,
  FunctionCallingConfigMode,
} from '@google/genai';

export type GeminiMessage = {
  role: 'user' | 'model';
  parts: Part[];
};

export type StreamDelta = {
  text?: string;
  functionCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  finishReason?: string;
};

export type GeminiStreamCallback = (delta: StreamDelta) => void;

export class GeminiClient {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  setModel(model: string) {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async streamChat(
    systemInstruction: string,
    history: GeminiMessage[],
    tools: FunctionDeclaration[],
    onDelta: GeminiStreamCallback,
    signal?: AbortSignal
  ): Promise<{
    text: string;
    functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    finishReason: string;
  }> {
    const contents: Content[] = history.map((msg) => ({
      role: msg.role,
      parts: msg.parts,
    }));

    const geminiTools: GeminiTool[] = tools.length > 0 ? [{ functionDeclarations: tools }] : [];

    const response = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: geminiTools,
        toolConfig: tools.length > 0 ? {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        } : undefined,
        abortSignal: signal,
      },
    });

    let fullText = '';
    const functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
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
          onDelta({ text: part.text });
        }
        if (part.functionCall) {
          const fc = {
            id: `call_${Date.now()}_${callIndex++}`,
            name: part.functionCall.name || '',
            args: (part.functionCall.args as Record<string, unknown>) || {},
          };
          functionCalls.push(fc);
          onDelta({ functionCalls: [fc] });
        }
      }
    }

    onDelta({ finishReason });

    return { text: fullText, functionCalls, finishReason };
  }
}
