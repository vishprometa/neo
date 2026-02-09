/**
 * Loop detection service for Neo
 * Detects repetitive, non-productive tool call patterns
 * Inspired by gemini-cli's loopDetectionService
 */

import type { LLMMessage } from '../llm';

export interface LoopDetectionResult {
  /** Whether a loop was detected */
  isLooping: boolean;
  /** Type of loop detected */
  loopType?: 'tool_repeat' | 'content_repeat' | 'error_loop';
  /** Description of the detected loop */
  description?: string;
  /** Suggested action */
  suggestion?: string;
}

export interface LoopDetectionConfig {
  /** Minimum number of messages to check */
  minMessages?: number;
  /** Maximum number of consecutive similar tool calls */
  maxConsecutiveToolCalls?: number;
  /** Similarity threshold for content comparison (0-1) */
  similarityThreshold?: number;
  /** Maximum consecutive errors */
  maxConsecutiveErrors?: number;
}

const DEFAULT_MIN_MESSAGES = 4;
const DEFAULT_MAX_CONSECUTIVE_TOOL_CALLS = 3;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Extract tool calls from messages (OpenAI-compatible format)
 */
function extractToolCalls(messages: LLMMessage[]): Array<{ name: string; args: string }> {
  const toolCalls: Array<{ name: string; args: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          args: tc.function.arguments,
        });
      }
    }
  }

  return toolCalls;
}

/**
 * Extract errors from tool response messages
 */
function extractErrors(messages: LLMMessage[]): string[] {
  const errors: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed?.error) {
          errors.push(parsed.error);
        }
      } catch {
        // Not JSON, ignore
      }
    }
  }

  return errors;
}

/**
 * Calculate similarity between two strings using Jaccard similarity on word tokens.
 * More meaningful than character overlap — treats strings as sets of words.
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\s+/).filter(Boolean));
  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check for tool call repetition
 */
function checkToolRepetition(
  toolCalls: Array<{ name: string; args: string }>,
  maxConsecutive: number
): { isLooping: boolean; description?: string } {
  if (toolCalls.length < maxConsecutive) {
    return { isLooping: false };
  }

  // Check for exact repetition
  const recentCalls = toolCalls.slice(-maxConsecutive);
  const firstCall = `${recentCalls[0].name}:${recentCalls[0].args}`;
  const allSame = recentCalls.every((call) => `${call.name}:${call.args}` === firstCall);

  if (allSame) {
    return {
      isLooping: true,
      description: `Tool "${recentCalls[0].name}" was called ${maxConsecutive} times with identical arguments`,
    };
  }

  // Check for same tool with similar args
  const sameTool = recentCalls.every((call) => call.name === recentCalls[0].name);
  if (sameTool) {
    const argsSimilar = recentCalls.every((call) =>
      calculateSimilarity(call.args, recentCalls[0].args) > 0.9
    );
    if (argsSimilar) {
      return {
        isLooping: true,
        description: `Tool "${recentCalls[0].name}" was called ${maxConsecutive} times with very similar arguments`,
      };
    }
  }

  // Check for oscillation (A-B-A-B pattern)
  if (toolCalls.length >= 4) {
    const last4 = toolCalls.slice(-4);
    const isOscillating =
      last4[0].name === last4[2].name &&
      last4[1].name === last4[3].name &&
      last4[0].name !== last4[1].name &&
      calculateSimilarity(last4[0].args, last4[2].args) > 0.8 &&
      calculateSimilarity(last4[1].args, last4[3].args) > 0.8;

    if (isOscillating) {
      return {
        isLooping: true,
        description: `Oscillating between "${last4[0].name}" and "${last4[1].name}" — alternating back and forth without progress`,
      };
    }
  }

  return { isLooping: false };
}

/**
 * Check for error loop
 */
function checkErrorLoop(
  errors: string[],
  maxConsecutive: number
): { isLooping: boolean; description?: string } {
  if (errors.length < maxConsecutive) {
    return { isLooping: false };
  }

  const recentErrors = errors.slice(-maxConsecutive);

  // Check for same error repeating
  const firstError = recentErrors[0];
  const allSameError = recentErrors.every((err) => calculateSimilarity(err, firstError) > 0.8);

  if (allSameError) {
    return {
      isLooping: true,
      description: `Same error occurred ${maxConsecutive} times consecutively`,
    };
  }

  return { isLooping: false };
}

/**
 * Detect loops in conversation
 */
export function detectLoop(
  messages: LLMMessage[],
  config: LoopDetectionConfig = {}
): LoopDetectionResult {
  const minMessages = config.minMessages ?? DEFAULT_MIN_MESSAGES;
  const maxConsecutiveToolCalls = config.maxConsecutiveToolCalls ?? DEFAULT_MAX_CONSECUTIVE_TOOL_CALLS;
  const maxConsecutiveErrors = config.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;

  // Not enough messages to detect a loop
  if (messages.length < minMessages) {
    return { isLooping: false };
  }

  // Check for tool call repetition
  const toolCalls = extractToolCalls(messages);
  const toolRepetition = checkToolRepetition(toolCalls, maxConsecutiveToolCalls);
  if (toolRepetition.isLooping) {
    return {
      isLooping: true,
      loopType: 'tool_repeat',
      description: toolRepetition.description,
      suggestion: 'Try a different approach or ask the user for clarification.',
    };
  }

  // Check for error loops
  const errors = extractErrors(messages);
  const errorLoop = checkErrorLoop(errors, maxConsecutiveErrors);
  if (errorLoop.isLooping) {
    const lastError = errors.length > 0 ? errors[errors.length - 1] : '';
    return {
      isLooping: true,
      loopType: 'error_loop',
      description: errorLoop.description,
      suggestion: `The same error keeps occurring: "${lastError}". Try a fundamentally different approach or ask the user for help with the question tool.`,
    };
  }

  return { isLooping: false };
}

/**
 * Get loop detection suggestions
 */
export function getLoopSuggestion(loopType: string): string {
  switch (loopType) {
    case 'tool_repeat':
      return 'You seem to be repeating the same tool call. Try a different approach or verify the results of your previous call.';
    case 'content_repeat':
      return 'You seem to be generating similar content repeatedly. Consider if you have already addressed the user\'s request.';
    case 'error_loop':
      return 'The same error keeps occurring. Analyze the error message and try a different approach.';
    default:
      return 'A loop was detected. Please try a different approach.';
  }
}
