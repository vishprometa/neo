/**
 * Conversation compression service for Neo
 * Compresses long conversation histories to reduce token usage
 * Inspired by gemini-cli's ChatCompressionService
 */

import type { GeminiMessage } from '../gemini/client';
import { GeminiClient } from '../gemini/client';

export interface CompressionResult {
  /** Compressed messages */
  messages: GeminiMessage[];
  /** Number of messages before compression */
  originalCount: number;
  /** Number of messages after compression */
  compressedCount: number;
  /** Summary of compressed content */
  summary?: string;
}

export interface CompressionConfig {
  /** Maximum number of messages before compression kicks in */
  maxMessages?: number;
  /** Target number of messages after compression */
  targetMessages?: number;
  /** Whether to preserve the last N messages uncompressed */
  preserveRecent?: number;
  /** API key for compression model */
  apiKey: string;
}

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_TARGET_MESSAGES = 15;
const DEFAULT_PRESERVE_RECENT = 5;

/**
 * Compress conversation history
 */
export async function compressConversation(
  messages: GeminiMessage[],
  config: CompressionConfig
): Promise<CompressionResult> {
  const maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const targetMessages = config.targetMessages ?? DEFAULT_TARGET_MESSAGES;
  const preserveRecent = config.preserveRecent ?? DEFAULT_PRESERVE_RECENT;

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
  const summary = await generateConversationSummary(toCompress, config.apiKey);

  // Create compressed message
  const compressedMessage: GeminiMessage = {
    role: 'user',
    parts: [{
      text: `[CONVERSATION SUMMARY]\n\nThe following is a summary of the earlier conversation:\n\n${summary}\n\n[END SUMMARY]\n\nPlease continue the conversation considering this context.`,
    }],
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
  messages: GeminiMessage[],
  apiKey: string
): Promise<string> {
  const client = new GeminiClient(apiKey, 'gemini-2.0-flash-lite');

  // Format messages for summarization
  const formattedMessages = messages.map((msg) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const parts = msg.parts.map((part) => {
      if ('text' in part) return part.text;
      if ('functionCall' in part) {
        return `[Called tool: ${part.functionCall.name}]`;
      }
      if ('functionResponse' in part) {
        return `[Tool response: ${part.functionResponse.name}]`;
      }
      return '[Unknown part]';
    }).join('\n');
    return `${role}: ${parts}`;
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

  const result = await client.streamChat(
    'You are a helpful assistant that summarizes conversations accurately and concisely.',
    [{
      role: 'user',
      parts: [{ text: summaryPrompt }],
    }],
    [],
  );

  return result.text || 'Unable to generate summary.';
}

/**
 * Check if conversation needs compression
 */
export function needsCompression(
  messages: GeminiMessage[],
  maxMessages: number = DEFAULT_MAX_MESSAGES
): boolean {
  return messages.length > maxMessages;
}

/**
 * Estimate token count for messages (rough estimate)
 */
export function estimateTokens(messages: GeminiMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if ('text' in part) {
        chars += part.text.length;
      } else if ('functionCall' in part) {
        chars += JSON.stringify(part.functionCall).length;
      } else if ('functionResponse' in part) {
        chars += JSON.stringify(part.functionResponse).length;
      }
    }
  }
  // Rough estimate: 4 characters per token
  return Math.ceil(chars / 4);
}
