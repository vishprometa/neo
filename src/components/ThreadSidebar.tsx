import { SquarePen, Trash2, PencilLine, MessageSquare, Brain } from 'lucide-react';
import { MemoryBrowser } from './MemoryBrowser';
import type { Thread } from '../hooks';

type SidebarTab = 'threads' | 'memory';

interface ThreadSidebarProps {
  isOpen: boolean;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onDeleteThread: (threadId: string) => void;
  // Rename
  editingThreadId: string | null;
  editingThreadTitle: string;
  onEditingTitleChange: (title: string) => void;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onStartRename: (threadId: string) => void;
  onSaveRename: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  // Memory
  workspaceDir: string | null;
  onResync: () => void;
  isSyncing: boolean;
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function ThreadSidebar({
  isOpen,
  activeTab,
  onTabChange,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  editingThreadId,
  editingThreadTitle,
  onEditingTitleChange,
  editInputRef,
  onStartRename,
  onSaveRename,
  onRenameKeyDown,
  workspaceDir,
  onResync,
  isSyncing,
}: ThreadSidebarProps) {
  if (!isOpen) return null;

  return (
    <div className="thread-sidebar">
      {/* Tabs */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'threads' ? 'active' : ''}`}
          onClick={() => onTabChange('threads')}
        >
          <MessageSquare size={12} />
          <span>Threads</span>
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'memory' ? 'active' : ''}`}
          onClick={() => onTabChange('memory')}
        >
          <Brain size={12} />
          <span>Memory</span>
        </button>
      </div>

      {/* Threads tab content */}
      {activeTab === 'threads' && (
        <>
          <div className="thread-sidebar-header">
            <span className="thread-sidebar-title">Threads</span>
            <div className="thread-sidebar-actions">
              <button className="titlebar-btn" onClick={onNewThread} title="New chat">
                <SquarePen size={14} />
              </button>
            </div>
          </div>
          <div className="thread-list">
            {threads.map((t) => (
              <div
                key={t.id}
                className={`thread-item ${t.id === activeThreadId ? 'active' : ''}`}
                onClick={() => onSelectThread(t.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  {editingThreadId === t.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      className="thread-item-edit-input"
                      value={editingThreadTitle}
                      onChange={(e) => onEditingTitleChange(e.target.value)}
                      onKeyDown={onRenameKeyDown}
                      onBlur={onSaveRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="thread-item-title"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onStartRename(t.id);
                      }}
                      title="Double-click to rename"
                    >
                      {t.title}
                    </span>
                  )}
                  <div className="thread-item-actions">
                    <button
                      className="thread-item-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartRename(t.id);
                      }}
                      title="Rename thread"
                    >
                      <PencilLine size={12} />
                    </button>
                    <button
                      className="thread-item-action-btn thread-item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteThread(t.id);
                      }}
                      title="Delete thread"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="thread-item-meta">
                  <span>{t.messages.length} messages</span>
                  <span>•</span>
                  <span>{formatRelativeTime(t.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Memory tab content */}
      {activeTab === 'memory' && workspaceDir && (
        <MemoryBrowser
          workspaceDir={workspaceDir}
          onResync={onResync}
          isSyncing={isSyncing}
        />
      )}
    </div>
  );
}
