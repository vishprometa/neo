import { useRef, useEffect, useState, useCallback } from 'react';
import { Brain, X } from 'lucide-react';
import { Titlebar } from '../components/Titlebar';
import { ChatInput } from '../components/ChatInput';
import { MessageBlock } from '../components/MessageBlock';
import { ThreadSidebar } from '../components/ThreadSidebar';
import { DeleteThreadDialog } from '../components/DeleteThreadDialog';
import { SyncStatus } from '../components/SyncStatus';
import { useThreads, useChat, useMemorySync } from '../hooks';
import type { Message, ModelType } from '../lib/agent';
import type { ProviderConfig } from '../lib/llm';
import { getModelDisplayName } from '../lib/llm';

type SidebarTab = 'threads' | 'memory';

interface ChatViewProps {
  workspaceDir: string;
  providerConfig: ProviderConfig;
  isFocused: boolean;
  onOpenSettings: () => void;
  onNewWindow: () => void;
  error: string | null;
  setError: (error: string | null) => void;
}

export function ChatView({
  workspaceDir,
  providerConfig,
  isFocused,
  onOpenSettings,
  onNewWindow,
  error,
  setError,
}: ChatViewProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('threads');
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Thread management
  const {
    threads,
    activeThreadId,
    activeThread,
    messages,
    setMessages,
    selectThread,
    createThread,
    deleteThread,
    editingThreadId,
    editingThreadTitle,
    setEditingThreadTitle,
    editInputRef,
    startRename,
    saveRename,
    cancelRename,
  } = useThreads(workspaceDir);

  // Memory sync
  const { syncProgress, isSyncing, memoryStatus, resync } = useMemorySync({
    workspaceDir,
    providerConfig,
    onError: setError,
  });

  // Chat
  const {
    input,
    setInput,
    isProcessing,
    selectedModel,
    setSelectedModel,
    submit,
    cancel,
    toolCallCount,
    abortControllerRef,
  } = useChat({
    providerConfig,
    workspaceDir,
    messages,
    setMessages,
    onError: setError,
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle thread selection (reset assistant message ref)
  const handleSelectThread = useCallback((threadId: string) => {
    selectThread(threadId);
  }, [selectThread]);

  // Handle new thread
  const handleNewThread = useCallback(() => {
    createThread();
  }, [createThread]);

  // Handle delete thread with confirmation
  const handleRequestDelete = useCallback((threadId: string) => {
    setPendingDeleteThreadId(threadId);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteThreadId) {
      deleteThread(pendingDeleteThreadId);
      setPendingDeleteThreadId(null);
    }
  }, [pendingDeleteThreadId, deleteThread]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteThreadId(null);
  }, []);

  // Handle rename keydown
  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  }, [saveRename, cancelRename]);

  return (
    <>
      <Titlebar
        workspaceDir={workspaceDir}
        title={activeThread?.title}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onOpenSettings={onOpenSettings}
        onNewThread={handleNewThread}
        onIndexMemory={resync}
        onNewWindow={onNewWindow}
        isSidebarOpen={isSidebarOpen}
        isFocused={isFocused}
        isSyncing={isSyncing}
      />

      <div className="app-layout">
        <ThreadSidebar
          isOpen={isSidebarOpen}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onDeleteThread={handleRequestDelete}
          editingThreadId={editingThreadId}
          editingThreadTitle={editingThreadTitle}
          onEditingTitleChange={setEditingThreadTitle}
          editInputRef={editInputRef}
          onStartRename={startRename}
          onSaveRename={saveRename}
          onRenameKeyDown={handleRenameKeyDown}
          workspaceDir={workspaceDir}
          onResync={resync}
          isSyncing={isSyncing}
        />

        {/* Chat area */}
        <div className="chat-container">
          <div className="chat-header">
            <span className="chat-header-badge">
              {getModelDisplayName(providerConfig.provider, selectedModel)}
            </span>
            <span className="chat-header-badge">{messages.length} messages</span>
            {toolCallCount > 0 && (
              <span className="chat-header-badge">{toolCallCount} tool calls</span>
            )}
            <button className="chat-header-action" onClick={resync} disabled={isSyncing} title="Index workspace files">
              <Brain size={12} className={isSyncing ? 'animate-pulse' : ''} />
              {isSyncing ? 'Indexing...' : 'Index Files'}
            </button>
          </div>

          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">✨</div>
              <p className="chat-empty-title">What would you like to do?</p>
              <p className="chat-empty-subtitle">I can read, write, and search files in your workspace.</p>
              <button className="chat-empty-action" onClick={resync} disabled={isSyncing}>
                <Brain size={14} className={isSyncing ? 'animate-pulse' : ''} />
                {isSyncing ? 'Indexing workspace...' : 'Index workspace files'}
              </button>
              <p className="chat-empty-note">
                {memoryStatus?.initialized
                  ? `Indexed ${memoryStatus.fileCount} files • Last sync ${new Date(memoryStatus.lastSync).toLocaleDateString()}`
                  : 'Build semantic memory so you can ask "where is auth handled?"'}
              </p>
            </div>
          ) : (
            <div className="chat-messages">
              <div className="chat-messages-inner">
                {messages.map((message) => (
                  <div key={message.id} className="message">
                    {message.role === 'user' ? (
                      <div className="message-user">
                        <div className="message-user-content">{message.text}</div>
                      </div>
                    ) : (
                      <div className="message-assistant">
                        {message.blocks && message.blocks.map((block) => (
                          <MessageBlock key={block.id} block={block} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {isProcessing && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
                  <div className="thinking">
                    <div className="thinking-dots">
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                    </div>
                    <span>Thinking</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="error-banner-close">
                <X size={14} />
              </button>
            </div>
          )}

          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={submit}
            onCancel={cancel}
            isProcessing={isProcessing}
            disabled={isProcessing && !abortControllerRef.current}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            workspaceDir={workspaceDir}
          />
        </div>
      </div>

      <DeleteThreadDialog
        isOpen={!!pendingDeleteThreadId}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {isSyncing && syncProgress && <SyncStatus progress={syncProgress} />}
    </>
  );
}
