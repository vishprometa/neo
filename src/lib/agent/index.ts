export { AgentRuntime, type AgentEvent, type AgentEventHandler, type ModelType, type ChatMessage } from './runtime';
export { registry } from './registry';
export { registerTools } from './tools';
export { defineTool, type ToolContext, type ToolResult, type ToolDefinition } from './tool';
export * from './types';

// Advanced features
export {
  compressConversation,
  needsCompression,
  estimateTokens,
  type CompressionResult,
  type CompressionConfig,
} from './compression';

export {
  detectLoop,
  getLoopSuggestion,
  type LoopDetectionResult,
  type LoopDetectionConfig,
} from './loop-detection';

export {
  discoverTools,
  registerDiscoveredTools,
  listDiscoveredTools,
  type DiscoveredTool,
  type ToolDiscoveryConfig,
} from './tool-discovery';
