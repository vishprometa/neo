import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { Settings, PanelLeft, MessageSquare, Brain, Copy, Terminal, FolderOpen, ChevronDown } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DetectedEditor } from '../hooks/useEditorDetection';

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

/** App icon — real icon if available, fallback otherwise */
const AppIcon = ({ src, fallback, size = 16 }: { src?: string; fallback: React.ReactNode; size?: number }) => {
  if (src) {
    return <img src={src} alt="" width={size} height={size} style={{ borderRadius: 3 }} draggable={false} />;
  }
  return <>{fallback}</>;
};

/** Dropdown for choosing which editor to open the workspace in */
const EditorDropdown = ({
  editors,
  onSelect,
}: {
  editors: DetectedEditor[];
  onSelect: (editor: DetectedEditor) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (editors.length === 0) return null;

  const primary = editors[0];

  // Single editor — no dropdown needed
  if (editors.length === 1) {
    return (
      <button
        className="titlebar-icon-btn"
        onClick={() => onSelect(primary)}
        title={`Open in ${primary.name}`}
      >
        <AppIcon src={primary.iconDataUrl} fallback={<FolderOpen size={14} />} />
      </button>
    );
  }

  return (
    <div className="editor-dropdown" ref={ref}>
      <button
        className="titlebar-icon-btn editor-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Open in editor..."
      >
        <AppIcon src={primary.iconDataUrl} fallback={<FolderOpen size={14} />} />
        <ChevronDown size={10} style={{ marginLeft: 1, opacity: 0.6 }} />
      </button>
      {open && (
        <div className="editor-dropdown-menu">
          {editors.map((editor) => (
            <button
              key={editor.id}
              className="editor-dropdown-item"
              onClick={() => {
                onSelect(editor);
                setOpen(false);
              }}
            >
              <AppIcon src={editor.iconDataUrl} fallback={<FolderOpen size={14} />} size={18} />
              <span>{editor.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface TitlebarProps {
  workspaceDir?: string;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onNewThread?: () => void;
  onIndexMemory?: () => void;
  isSidebarOpen?: boolean;
  isFocused?: boolean;
  isSyncing?: boolean;
  editors?: DetectedEditor[];
  onOpenInEditor?: (editor: DetectedEditor) => void;
  onOpenInFinder?: () => void;
  onOpenInTerminal?: () => void;
  finderIcon?: string;
  terminalIcon?: string;
}

export function Titlebar({
  workspaceDir,
  onToggleSidebar,
  onOpenSettings,
  onNewThread,
  onIndexMemory,
  isSidebarOpen = false,
  isFocused = true,
  isSyncing = false,
  editors = [],
  onOpenInEditor,
  onOpenInFinder,
  onOpenInTerminal,
  finderIcon,
  terminalIcon,
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
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('.editor-dropdown-menu')) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error('Failed to start dragging:', err);
    }
  }, []);

  const handleTitlebarDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('.editor-dropdown-menu')) return;
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

  const handleCopyPath = useCallback(async () => {
    if (!workspaceDir) return;
    try {
      await navigator.clipboard.writeText(workspaceDir);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  }, [workspaceDir]);

  const shortPath = workspaceDir
    ? workspaceDir.replace(/^\/Users\/[^/]+/, '~')
    : '';

  return (
    <div
      ref={titlebarRef}
      className={`titlebar ${!isFocused ? 'unfocused' : ''}`}
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="titlebar-left">
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
          <div className="titlebar-workspace-bar">
            <span className="titlebar-workspace-path">{shortPath}</span>
            <button
              className="titlebar-icon-btn"
              onClick={handleCopyPath}
              title="Copy path"
            >
              <Copy size={12} />
            </button>
            {onOpenInTerminal && (
              <button
                className="titlebar-icon-btn"
                onClick={onOpenInTerminal}
                title="Open in Terminal"
              >
                <AppIcon src={terminalIcon} fallback={<Terminal size={14} />} />
              </button>
            )}
            {onOpenInFinder && (
              <button
                className="titlebar-icon-btn"
                onClick={onOpenInFinder}
                title="Reveal in Finder"
              >
                <AppIcon src={finderIcon} fallback={<FolderOpen size={14} />} />
              </button>
            )}
            {onOpenInEditor && editors.length > 0 && (
              <EditorDropdown
                editors={editors}
                onSelect={(editor) => onOpenInEditor(editor)}
              />
            )}
          </div>
        )}
      </div>

      <div className="titlebar-right">
        {onIndexMemory && (
          <button
            className={`titlebar-btn ${isSyncing ? 'active' : ''}`}
            onClick={onIndexMemory}
            disabled={isSyncing}
            title={isSyncing ? 'Syncing in progress...' : 'Sync workspace'}
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
