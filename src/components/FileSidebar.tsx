import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Search,
  ExternalLink,
  FolderOpen,
  Copy,
} from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { open } from '@tauri-apps/plugin-shell';
import { join, dirname } from '@tauri-apps/api/path';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileItem[];
  path: string;
}

interface FileSidebarProps {
  isOpen: boolean;
  workspaceDir: string;
  files?: FileItem[];
  onSelectFile?: (path: string) => void;
  onClose?: () => void;
  selectedPath?: string;
}

interface TreeItemProps {
  item: FileItem;
  depth: number;
  selectedPath?: string;
  onSelect: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
}

function TreeItem({
  item,
  depth,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
  onContextMenu,
}: TreeItemProps) {
  const isExpanded = expandedPaths.has(item.path);
  const isSelected = selectedPath === item.path;
  const isFolder = item.type === 'folder';

  const handleClick = () => {
    if (isFolder) {
      onToggleExpand(item.path);
    } else {
      onSelect(item.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, item);
  };

  return (
    <div>
      <div
        className={`sidebar-item ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {isFolder && (
          <span className="sidebar-item-chevron">
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        <span className="sidebar-item-icon">
          {isFolder ? <Folder size={14} /> : <FileText size={14} />}
        </span>
        <span className="sidebar-item-name">{item.name}</span>
      </div>
      {isFolder && isExpanded && item.children && (
        <div className="sidebar-children">
          {item.children.map((child) => (
            <TreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileSidebar({
  isOpen,
  workspaceDir,
  files = [],
  onSelectFile,
  onClose: _onClose,
  selectedPath,
}: FileSidebarProps) {
  const DEFAULT_WIDTH = 220;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 400;
  
  const asideRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const raw = localStorage.getItem('neo.filesidebar.width');
      const n = Number(raw);
      if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    } catch {}
    return DEFAULT_WIDTH;
  });

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    item: FileItem | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, item: null });

  useEffect(() => {
    try {
      document.documentElement.style.setProperty('--file-sidebar-width', `${sidebarWidth}px`);
      localStorage.setItem('neo.filesidebar.width', String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);

  // Handle context menu open
  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileItem) => {
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      item,
    });
  }, []);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Open file with default app
  const handleOpenWithDefault = useCallback(async () => {
    if (!contextMenu.item) return;
    try {
      const fullPath = await join(workspaceDir, contextMenu.item.path);
      await open(fullPath);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [contextMenu.item, workspaceDir]);

  // Reveal in Finder (macOS)
  const handleRevealInFinder = useCallback(async () => {
    if (!contextMenu.item) return;
    try {
      const fullPath = await join(workspaceDir, contextMenu.item.path);
      // Use 'open -R' to reveal file in Finder on macOS
      await open(`file://${fullPath}`, 'open');
    } catch (err) {
      console.error('Failed to reveal in Finder:', err);
      // Fallback: open the parent directory
      try {
        const fullPath = await join(workspaceDir, contextMenu.item.path);
        const parentDir = await dirname(fullPath);
        await open(parentDir);
      } catch (fallbackErr) {
        console.error('Failed to open parent directory:', fallbackErr);
      }
    }
  }, [contextMenu.item, workspaceDir]);

  // Copy path to clipboard
  const handleCopyPath = useCallback(async () => {
    if (!contextMenu.item) return;
    try {
      const fullPath = await join(workspaceDir, contextMenu.item.path);
      await navigator.clipboard.writeText(fullPath);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  }, [contextMenu.item, workspaceDir]);

  // Build context menu items
  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu.item) return [];
    
    const items: ContextMenuItem[] = [
      {
        id: 'open',
        label: contextMenu.item.type === 'folder' ? 'Open Folder' : 'Open with Default App',
        icon: ExternalLink,
        onClick: handleOpenWithDefault,
      },
      {
        id: 'reveal',
        label: 'Reveal in Finder',
        icon: FolderOpen,
        onClick: handleRevealInFinder,
      },
      {
        id: 'separator-1',
        label: '',
        separator: true,
        onClick: () => {},
      },
      {
        id: 'copy-path',
        label: 'Copy Path',
        icon: Copy,
        onClick: handleCopyPath,
      },
    ];

    return items;
  }, [contextMenu.item, handleOpenWithDefault, handleRevealInFinder, handleCopyPath]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = sidebarWidth;
    asideRef.current?.classList?.add('resizing');

    const onMove = (ev: MouseEvent) => {
      // For right-side sidebar, dragging left increases width
      const dx = startX - ev.clientX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + dx));
      setSidebarWidth(next);
    };

    const onUp = () => {
      asideRef.current?.classList?.remove('resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleToggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelect = (path: string) => {
    onSelectFile?.(path);
  };

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    
    const filterTree = (items: FileItem[]): FileItem[] => {
      return items.reduce<FileItem[]>((acc, item) => {
        if (item.name.toLowerCase().includes(q)) {
          acc.push(item);
        } else if (item.type === 'folder' && item.children) {
          const filteredChildren = filterTree(item.children);
          if (filteredChildren.length > 0) {
            acc.push({ ...item, children: filteredChildren });
          }
        }
        return acc;
      }, []);
    };
    
    return filterTree(files);
  }, [files, searchQuery]);

  const folderName = workspaceDir.split('/').pop() || workspaceDir;

  return (
    <aside
      ref={asideRef}
      className={`file-sidebar ${isOpen ? 'open' : 'closed'}`}
      style={{ width: isOpen ? sidebarWidth : 0 }}
    >
      <div
        className="sidebar-resizer sidebar-resizer-left"
        onMouseDown={startResize}
        onDoubleClick={() => setSidebarWidth(DEFAULT_WIDTH)}
        title="Drag to resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
      <div className="sidebar-content">
        <div className="sidebar-header">
          <span className="sidebar-header-title">{folderName}</span>
        </div>

        <div className="sidebar-search">
          <Search size={12} className="sidebar-search-icon" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sidebar-search-input"
          />
        </div>

        <div className="sidebar-tree">
          {filteredFiles.length === 0 ? (
            <div className="sidebar-empty">
              <FileText size={16} />
              <span>No files found</span>
            </div>
          ) : (
            filteredFiles.map((item) => (
              <TreeItem
                key={item.path}
                item={item}
                depth={0}
                selectedPath={selectedPath}
                onSelect={handleSelect}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                onContextMenu={handleContextMenu}
              />
            ))
          )}
        </div>
      </div>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />
    </aside>
  );
}
