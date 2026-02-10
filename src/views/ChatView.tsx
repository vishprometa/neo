import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Brain, X, StopCircle, ClipboardList, FileText, Sparkles, Search } from 'lucide-react';
import { Titlebar } from '../components/Titlebar';
import { ChatInput } from '../components/ChatInput';
import { MessageBlock } from '../components/MessageBlock';
import { TaskSidebar } from '../components/TaskSidebar';
import { ThreadSidebar } from '../components/ThreadSidebar';
import { DeleteThreadDialog } from '../components/DeleteThreadDialog';
import { SyncStatus } from '../components/SyncStatus';
import { StarburstIcon } from '../components/StarburstIcon';
import type { LogEntry } from '../hooks/useMemorySync';
import { useThreads, useChat } from '../hooks';
import { useEditorDetection } from '../hooks/useEditorDetection';
import type { SyncProgress } from '../lib/memory';
import type { ProviderConfig } from '../lib/llm';
import { getModelDisplayName } from '../lib/llm';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

type SidebarTab = 'threads' | 'memory';

interface ChatViewProps {
  workspaceDir: string;
  providerConfig: ProviderConfig;
  isFocused: boolean;
  onOpenSettings: () => void;
  onNewWindow: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  logs: LogEntry[];
  onLog: (entry: LogEntry) => void;
  syncProgress: SyncProgress | null;
  isSyncing: boolean;
  memoryStatus: { initialized: boolean; lastSync: number; fileCount: number } | null;
  resync: () => void;
  stopSync: () => void;
}

export function ChatView({
  workspaceDir,
  providerConfig,
  isFocused,
  onOpenSettings,
  onNewWindow: _onNewWindow,
  error,
  setError,
  logs: _logs,
  onLog,
  syncProgress,
  isSyncing,
  memoryStatus,
  resync,
  stopSync,
}: ChatViewProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('threads');
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Thread management
  const {
    threads,
    activeThreadId,
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

  // Editor detection
  const { editors, openInEditor, openInFinder, openInTerminal, finderIcon, terminalIcon } = useEditorDetection();

  // Rotating coworker greetings — picked once per thread
  const coworkGreeting = useMemo(() => {
    const greetings = [
      "What are we building today?",
      "Let's knock something out",
      "Ready when you are",
      "What's on deck?",
      "Let's get to work",
      "What needs doing?",
      "Where were we?",
      "Let's make some progress",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }, [activeThreadId]);

  // Toggle sidebar on the Memory tab
  const handleOpenMemory = useCallback(() => {
    if (isSidebarOpen && sidebarTab === 'memory') {
      setIsSidebarOpen(false);
    } else {
      setSidebarTab('memory');
      setIsSidebarOpen(true);
    }
  }, [isSidebarOpen, sidebarTab]);

  const handleOpenLogsWindow = useCallback(() => {
    const label = `neo-logs-${Date.now()}`;
    const win = new WebviewWindow(label, {
      url: '/?logs=1',
      title: 'Neo Logs',
      width: 600,
      height: 800,
      resizable: true,
    });
    win.once('tauri://error', (e) => {
      onLog({
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        level: 'error',
        message: `Failed to open logs window: ${String(e)}`,
      });
    });
  }, [onLog]);

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
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onOpenSettings={onOpenSettings}
        onNewThread={handleNewThread}
        onIndexMemory={resync}
        isSidebarOpen={isSidebarOpen}
        isFocused={isFocused}
        isSyncing={isSyncing}
        editors={editors}
        onOpenInEditor={(editor) => openInEditor(editor, workspaceDir)}
        onOpenInFinder={() => openInFinder(workspaceDir)}
        onOpenInTerminal={() => openInTerminal(workspaceDir)}
        finderIcon={finderIcon}
        terminalIcon={terminalIcon}
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
          {messages.length > 0 && (
            <div className="chat-header">
              <span className="chat-header-badge">
                {getModelDisplayName(providerConfig.provider, selectedModel)}
              </span>
              <span className="chat-header-badge">{messages.length} messages</span>
              {toolCallCount > 0 && (
                <span className="chat-header-badge">{toolCallCount} tool calls</span>
              )}
              {isSyncing ? (
                <button
                  className="chat-header-action chat-header-action-stop"
                  onClick={stopSync}
                  title="Stop indexing"
                >
                  <StopCircle size={12} />
                  Stop Indexing
                </button>
              ) : (
                <button className="chat-header-action" onClick={resync} title="Index workspace files">
                  <Brain size={12} />
                  Index Files
                </button>
              )}
              <button
                className="chat-header-action"
                onClick={handleOpenMemory}
                title="Open memory browser"
              >
                <Brain size={12} />
                Memory
              </button>
              <button
                className="chat-header-action"
                onClick={handleOpenLogsWindow}
                title="Open logs in a new window"
              >
                Logs
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="cowork-empty cowork-grid-bg">
              <div className="cowork-empty-content">
                <StarburstIcon size={36} className="cowork-starburst" />
                <h2 className="cowork-empty-heading">{coworkGreeting}</h2>

                {/* Info banner - intelligent file system */}
                <div className="cowork-info-banner">
                  <Brain size={15} />
                  <span>
                    {memoryStatus?.initialized
                      ? `${memoryStatus.fileCount} files indexed. Neo understands your workspace.`
                      : 'Neo indexes your files so the agent works better.'}
                    {!memoryStatus?.initialized && !isSyncing && (
                      <button className="cowork-info-link" onClick={resync}>Start scanning</button>
                    )}
                  </span>
                </div>

                {/* Task suggestion cards */}
                <div className="cowork-tasks">
                  <div className="cowork-tasks-header">
                    <div className="cowork-tasks-header-left">
                      <Sparkles size={13} />
                      <span>Pick a task, any task</span>
                    </div>
                  </div>
                  <div className="cowork-tasks-grid">
                    <button
                      className="cowork-task-card"
                      onClick={() => setInput('What do you know about this workspace?')}
                    >
                      <Search size={16} />
                      <span>Explore workspace</span>
                    </button>
                    <button
                      className="cowork-task-card"
                      onClick={() => setInput('Review my recent changes and suggest improvements')}
                    >
                      <ClipboardList size={16} />
                      <span>Review my work</span>
                    </button>
                    <button
                      className="cowork-task-card"
                      onClick={() => setInput('Summarize what this project is about')}
                    >
                      <FileText size={16} />
                      <span>Summarize project</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="chat-body">
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
              <TaskSidebar messages={messages} />
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

      {isSyncing && syncProgress && <SyncStatus progress={syncProgress} onStop={stopSync} />}
    </>
  );
}
