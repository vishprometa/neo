import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { Settings, FolderOpen, PanelLeft, MessageSquare, Brain, Files } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const isMac = () => {
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();
    return ua.includes('mac') || platform.includes('mac');
  } catch {
    return false;
  }
};

interface TrafficLightsProps {
  onToggleMaximize: () => Promise<void>;
}

const TrafficLights = ({ onToggleMaximize }: TrafficLightsProps) => {
  const [hovered, setHovered] = useState(false);

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Failed to close window:', err);
    }
  };

  const handleMinimize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error('Failed to minimize window:', err);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await onToggleMaximize();
    } catch (err) {
      console.error('Failed to maximize window:', err);
    }
  };

  return (
    <div 
      className="traffic-lights"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button 
        className="traffic-light traffic-light-close"
        onClick={handleClose}
        aria-label="Close"
      >
        {hovered && (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      <button 
        className="traffic-light traffic-light-minimize"
        onClick={handleMinimize}
        aria-label="Minimize"
      >
        {hovered && (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M1 4H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      <button 
        className="traffic-light traffic-light-maximize"
        onClick={handleMaximize}
        aria-label="Maximize"
      >
        {hovered && (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M2 6V2h4v4H2z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          </svg>
        )}
      </button>
    </div>
  );
};

interface TitlebarProps {
  title?: string;
  workspaceDir?: string;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onNewThread?: () => void;
  onIndexMemory?: () => void;
  onToggleFileTree?: () => void;
  isSidebarOpen?: boolean;
  isFileTreeOpen?: boolean;
  isFocused?: boolean;
  isSyncing?: boolean;
}

export function Titlebar({
  title,
  workspaceDir,
  onToggleSidebar,
  onOpenSettings,
  onNewThread,
  onIndexMemory,
  onToggleFileTree,
  isSidebarOpen = false,
  isFileTreeOpen = false,
  isFocused = true,
  isSyncing = false,
}: TitlebarProps) {
  const titlebarRef = useRef<HTMLDivElement>(null);

  const toggleMaximize = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (err) {
      console.error('Failed to toggle maximize:', err);
    }
  }, []);

  const handleTitlebarMouseDown = useCallback(async (event: React.MouseEvent) => {
    // Only handle left mouse button
    if (event.button !== 0) return;
    
    // Don't drag if clicking on interactive elements
    const target = event.target as HTMLElement;
    if (target.closest('.no-drag') || target.closest('button')) return;
    
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error('Failed to start dragging:', err);
    }
  }, []);

  const handleTitlebarDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.no-drag') || target.closest('button')) return;
    
    event.preventDefault();
    event.stopPropagation();
    void toggleMaximize();
  }, [toggleMaximize]);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const el = titlebarRef.current;
    if (!el) return;
    const root = document.documentElement;
    if (!root) return;
    const setHeight = () => {
      const next = el.getBoundingClientRect().height;
      if (next) root.style.setProperty('--titlebar-height', `${next}px`);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setHeight) : null;
    observer?.observe(el);
    setHeight();
    return () => observer?.disconnect();
  }, []);

  const folderName = workspaceDir?.split('/').pop() || '';

  return (
    <div
      ref={titlebarRef}
      className={`titlebar ${!isFocused ? 'unfocused' : ''}`}
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="titlebar-left no-drag">
        {isMac() && <TrafficLights onToggleMaximize={toggleMaximize} />}
        {onToggleSidebar && (
          <button
            className={`titlebar-btn ${isSidebarOpen ? 'active' : ''}`}
            onClick={onToggleSidebar}
            title="Toggle Sidebar"
          >
            <PanelLeft size={14} />
          </button>
        )}
      </div>

      <div className="titlebar-center">
        {workspaceDir && (
          <div className="titlebar-workspace">
            <FolderOpen size={12} className="text-muted-foreground" />
            <span className="titlebar-workspace-name">{folderName}</span>
          </div>
        )}
        {title && <span className="titlebar-title">{title}</span>}
      </div>

      <div className="titlebar-right no-drag">
        {onIndexMemory && (
          <button
            className={`titlebar-btn ${isSyncing ? 'active' : ''}`}
            onClick={onIndexMemory}
            disabled={isSyncing}
            title={isSyncing ? 'Indexing in progress...' : 'Index workspace files'}
          >
            <Brain size={14} className={isSyncing ? 'animate-pulse' : ''} />
          </button>
        )}
        {onNewThread && (
          <button
            className="titlebar-btn"
            onClick={onNewThread}
            title="New Chat"
          >
            <MessageSquare size={14} />
          </button>
        )}
        {onToggleFileTree && (
          <button
            className={`titlebar-btn ${isFileTreeOpen ? 'active' : ''}`}
            onClick={onToggleFileTree}
            title="Toggle Files"
          >
            <Files size={14} />
          </button>
        )}
        {onOpenSettings && (
          <button
            className="titlebar-btn"
            onClick={onOpenSettings}
            title="Settings"
          >
            <Settings size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
