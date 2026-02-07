/**
 * Unified LLM module for Neo
 * Supports both Gemini (direct) and OpenRouter providers
 */
import { GeminiClient, GEMINI_MODELS, validateGeminiApiKey } from './gemini-client';
import { OpenRouterClient, OPENROUTER_MODELS, validateOpenRouterApiKey } from './openrouter-client';
import type {
  LLMProvider,
  LLMClient,
  LLMMessage,
  LLMTool,
  LLMStreamDelta,
  LLMChatResult,
  LLMFunctionCall,
  ProviderConfig,
  ModelType,
} from './types';

export type {
  LLMProvider,
  LLMClient,
  LLMMessage,
  LLMTool,
  LLMStreamDelta,
  LLMChatResult,
  LLMFunctionCall,
  ProviderConfig,
  ModelType,
};

export { GeminiClient, GEMINI_MODELS, validateGeminiApiKey };
export { OpenRouterClient, OPENROUTER_MODELS, validateOpenRouterApiKey };

/** Model mapping for each provider */
const MODEL_MAP: Record<LLMProvider, Record<ModelType, string>> = {
  gemini: {
    fast: GEMINI_MODELS.FAST,
    thinking: GEMINI_MODELS.THINKING,
  },
  openrouter: {
    fast: OPENROUTER_MODELS.GEMINI_3_FLASH,
    thinking: OPENROUTER_MODELS.GEMINI_3_PRO,
  },
};

/** Summarization models for each provider */
const SUMMARIZATION_MODEL: Record<LLMProvider, string> = {
  gemini: GEMINI_MODELS.FLASH,
  openrouter: OPENROUTER_MODELS.GEMINI_2_5_FLASH,
};

/** Compression models for each provider */
const COMPRESSION_MODEL: Record<LLMProvider, string> = {
  gemini: GEMINI_MODELS.FLASH_LITE,
  openrouter: OPENROUTER_MODELS.GEMINI_2_5_FLASH_LITE,
};

/**
 * Create an LLM client for the specified provider
 */
export function createClient(config: ProviderConfig, modelType: ModelType = 'fast'): LLMClient {
  const model = MODEL_MAP[config.provider][modelType];
  
  switch (config.provider) {
    case 'gemini':
      return new GeminiClient(config.apiKey, model);
    case 'openrouter':
      return new OpenRouterClient(config.apiKey, model, {
        logPath: config.logPath,
        pdfEngine: config.openrouterPdfEngine,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Create a summarization client (for semantic memory)
 */
export function createSummarizationClient(config: ProviderConfig): LLMClient {
  const model = SUMMARIZATION_MODEL[config.provider];
  
  switch (config.provider) {
    case 'gemini':
      return new GeminiClient(config.apiKey, model);
    case 'openrouter':
      return new OpenRouterClient(config.apiKey, model, {
        logPath: config.logPath,
        pdfEngine: config.openrouterPdfEngine,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Create a compression client (for conversation compression)
 */
export function createCompressionClient(config: ProviderConfig): LLMClient {
  const model = COMPRESSION_MODEL[config.provider];
  
  switch (config.provider) {
    case 'gemini':
      return new GeminiClient(config.apiKey, model);
    case 'openrouter':
      return new OpenRouterClient(config.apiKey, model, {
        logPath: config.logPath,
        pdfEngine: config.openrouterPdfEngine,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Validate an API key for the specified provider
 */
export async function validateApiKey(provider: LLMProvider, apiKey: string): Promise<boolean> {
  switch (provider) {
    case 'gemini':
      return validateGeminiApiKey(apiKey);
    case 'openrouter':
      return validateOpenRouterApiKey(apiKey);
    default:
      return false;
  }
}

/**
 * Get display name for a provider
 */
export function getProviderDisplayName(provider: LLMProvider): string {
  switch (provider) {
    case 'gemini':
      return 'Google Gemini (Direct)';
    case 'openrouter':
      return 'OpenRouter';
    default:
      return provider;
  }
}

/**
 * Get display name for a model based on provider
 */
export function getModelDisplayName(provider: LLMProvider, modelType: ModelType): string {
  switch (provider) {
    case 'gemini':
      return modelType === 'fast' ? 'Gemini 2.5 Flash' : 'Gemini 2.5 Pro';
    case 'openrouter':
      return modelType === 'fast' ? 'Gemini 3 Flash' : 'Gemini 3 Pro';
    default:
      return 'Unknown Model';
  }
}

/**
 * Get API key placeholder for provider
 */
export function getApiKeyPlaceholder(provider: LLMProvider): string {
  switch (provider) {
    case 'gemini':
      return 'Enter your Google AI API key';
    case 'openrouter':
      return 'Enter your OpenRouter API key';
    default:
      return 'Enter your API key';
  }
}

/**
 * Get API key URL for provider
 */
export function getApiKeyUrl(provider: LLMProvider): { url: string; label: string } {
  switch (provider) {
    case 'gemini':
      return { url: 'https://aistudio.google.com/apikey', label: 'Google AI Studio' };
    case 'openrouter':
      return { url: 'https://openrouter.ai/keys', label: 'OpenRouter' };
    default:
      return { url: '#', label: 'Unknown' };
  }
}
