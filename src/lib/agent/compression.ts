/**
 * Conversation compression service for Neo
 * Compresses long conversation histories to reduce token usage
 * Inspired by gemini-cli's ChatCompressionService
 */

import type { LLMMessage, ProviderConfig } from '../llm';
import { createCompressionClient } from '../llm';

export interface CompressionResult {
  /** Compressed messages */
  messages: LLMMessage[];
  /** Number of messages before compression */
  originalCount: number;
  /** Number of messages after compression */
  compressedCount: number;
  /** Summary of compressed content */
  summary?: string;
}

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_PRESERVE_RECENT = 5;

/**
 * Compress conversation history
 */
export async function compressConversation(
  messages: LLMMessage[],
  config: ProviderConfig,
  options?: {
    maxMessages?: number;
    targetMessages?: number;
    preserveRecent?: number;
  }
): Promise<CompressionResult> {
  const maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const preserveRecent = options?.preserveRecent ?? DEFAULT_PRESERVE_RECENT;

  // Don't compress if under threshold
  if (messages.length <= maxMessages) {
    return {
      messages,
      originalCount: messages.length,
      compressedCount: messages.length,
    };
  }

  // Split messages into sections
  const recentMessages = messages.slice(-preserveRecent);
  const toCompress = messages.slice(0, -preserveRecent);

  if (toCompress.length === 0) {
    return {
      messages,
      originalCount: messages.length,
      compressedCount: messages.length,
    };
  }

  // Generate summary of compressed messages
  const summary = await generateConversationSummary(toCompress, config);

  // Create compressed message
  const compressedMessage: LLMMessage = {
    role: 'user',
    content: `[CONVERSATION SUMMARY]\n\nThe following is a summary of the earlier conversation:\n\n${summary}\n\n[END SUMMARY]\n\nPlease continue the conversation considering this context.`,
  };

  const compressedMessages = [compressedMessage, ...recentMessages];

  return {
    messages: compressedMessages,
    originalCount: messages.length,
    compressedCount: compressedMessages.length,
    summary,
  };
}

/**
 * Generate a summary of conversation messages
 */
async function generateConversationSummary(
  messages: LLMMessage[],
  config: ProviderConfig
): Promise<string> {
  const client = createCompressionClient(config);

  // Format messages for summarization
  const formattedMessages = messages.map((msg) => {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'Tool';
    
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.map((part) => part.text || '[non-text]').join('\n');
    }
    
    if (msg.tool_calls) {
      content += `\n[Called tools: ${msg.tool_calls.map((tc) => tc.function.name).join(', ')}]`;
    }
    
    return `${role}: ${content}`;
  }).join('\n\n');

  const summaryPrompt = `Please summarize the following conversation between a user and an AI coding assistant. 
Focus on:
1. What the user asked for or wanted to accomplish
2. What files were read or modified
3. Key decisions or conclusions reached
4. Any important context that should be remembered

Keep the summary concise but comprehensive (200-400 words).

Conversation:
${formattedMessages}`;

  const result = await client.complete(
    'You are a helpful assistant that summarizes conversations accurately and concisely.',
    summaryPrompt,
    1024
  );

  return result || 'Unable to generate summary.';
}

/**
 * Check if conversation needs compression
 */
export function needsCompression(
  messages: LLMMessage[],
  maxMessages: number = DEFAULT_MAX_MESSAGES
): boolean {
  return messages.length > maxMessages;
}

/**
 * Estimate token count for messages (rough estimate)
 */
export function estimateTokens(messages: LLMMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.text) {
          chars += part.text.length;
        }
      }
    }
    if (msg.tool_calls) {
      chars += JSON.stringify(msg.tool_calls).length;
    }
  }
  // Rough estimate: 4 characters per token
  return Math.ceil(chars / 4);
}
