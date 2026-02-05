import { useState, useRef, useCallback } from 'react';
import { AgentRuntime, type AgentEvent, type Message, type ContentBlock, type ModelType } from '../lib/agent';

interface UseChatOptions {
  apiKey: string | null;
  workspaceDir: string | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onError: (error: string) => void;
}

export function useChat({ apiKey, workspaceDir, messages, setMessages, onError }: UseChatOptions) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelType>('fast');

  const runtimeRef = useRef<AgentRuntime | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);

  const initializeRuntime = useCallback(async () => {
    if (runtimeRef.current) return runtimeRef.current;
    if (!apiKey || !workspaceDir) {
      onError('No API key configured. Please add your Gemini API key in settings.');
      return null;
    }
    try {
      const runtime = new AgentRuntime(apiKey, workspaceDir);
      await runtime.initialize();
      runtimeRef.current = runtime;
      return runtime;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onError(`Failed to initialize: ${errorMsg}`);
      return null;
    }
  }, [workspaceDir, apiKey, onError]);

  const mergeBlockIntoMessages = useCallback((block: ContentBlock) => {
    setMessages((prev) => {
      const updated = [...prev];
      const assistantMsgId = currentAssistantMsgIdRef.current;

      let assistantMsg = assistantMsgId
        ? updated.find((m) => m.id === assistantMsgId)
        : null;

      if (!assistantMsg) {
        const newMsgId = `assistant_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        currentAssistantMsgIdRef.current = newMsgId;
        assistantMsg = {
          id: newMsgId,
          role: 'assistant',
          blocks: [],
          timestamp: Date.now(),
        };
        updated.push(assistantMsg);
      }

      const msgIndex = updated.findIndex((m) => m.id === assistantMsg!.id);
      if (msgIndex >= 0) {
        const blocks = [...(updated[msgIndex].blocks || [])];
        const existingBlockIdx = blocks.findIndex((b) => b.id === block.id);

        if (existingBlockIdx >= 0) {
          blocks[existingBlockIdx] = block;
        } else {
          blocks.push(block);
        }

        updated[msgIndex] = { ...updated[msgIndex], blocks };
      }

      return updated;
    });
  }, [setMessages]);

  const submit = useCallback(async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage = input.trim();
    setInput('');
    setIsProcessing(true);
    currentAssistantMsgIdRef.current = null;

    // Add user message
    const userMsgId = `user_${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: userMsgId,
      role: 'user',
      text: userMessage,
      timestamp: Date.now(),
    }]);

    const runtime = await initializeRuntime();
    if (!runtime) {
      setIsProcessing(false);
      return;
    }

    runtime.setModelType(selectedModel);
    abortControllerRef.current = new AbortController();

    runtime.setEventHandler((event: AgentEvent) => {
      switch (event.type) {
        case 'content_block_update':
          mergeBlockIntoMessages(event.block);
          break;

        case 'processing_complete':
          setIsProcessing(false);
          currentAssistantMsgIdRef.current = null;
          break;

        case 'processing_error':
          setIsProcessing(false);
          onError(event.error);
          currentAssistantMsgIdRef.current = null;
          break;
      }
    });

    try {
      await runtime.sendMessage(userMessage, abortControllerRef.current.signal);
    } catch (err) {
      if (err instanceof Error && err.message !== 'Aborted') {
        onError(err.message);
      }
    }
  }, [input, isProcessing, selectedModel, initializeRuntime, mergeBlockIntoMessages, setMessages, onError]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
    currentAssistantMsgIdRef.current = null;
  }, []);

  const resetRuntime = useCallback(() => {
    runtimeRef.current = null;
    currentAssistantMsgIdRef.current = null;
  }, []);

  // Count tool calls for stats
  const toolCallCount = messages.reduce((count, m) => {
    if (m.blocks) {
      return count + m.blocks.filter(b => b.format === 'tool_result').length;
    }
    return count;
  }, 0);

  return {
    input,
    setInput,
    isProcessing,
    selectedModel,
    setSelectedModel,
    submit,
    cancel,
    resetRuntime,
    toolCallCount,
    abortControllerRef,
  };
}
