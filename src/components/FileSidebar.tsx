import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  PencilLine,
} from 'lucide-react';

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
}

function TreeItem({
  item,
  depth,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
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

  return (
    <div>
      <div
        className={`sidebar-item ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        onClick={handleClick}
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
  onClose,
  selectedPath,
}: FileSidebarProps) {
  const DEFAULT_WIDTH = 220;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 400;
  
  const asideRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const raw = localStorage.getItem('neo.sidebar.width');
      const n = Number(raw);
      if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    } catch {}
    return DEFAULT_WIDTH;
  });

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    try {
      document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
      localStorage.setItem('neo.sidebar.width', String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = sidebarWidth;
    asideRef.current?.classList?.add('resizing');

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
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
              />
            ))
          )}
        </div>
      </div>

      <div
        className="sidebar-resizer"
        onMouseDown={startResize}
        onDoubleClick={() => setSidebarWidth(DEFAULT_WIDTH)}
        title="Drag to resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </aside>
  );
}
