import { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Brain,
  BookOpen,
  FolderOpen,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';
import { listMemoryFiles, readMemoryFile, getSyncStatus } from '../lib/memory';

interface MemoryBrowserProps {
  workspaceDir: string;
  onResync?: () => void;
  isSyncing?: boolean;
}

interface MemoryFile {
  path: string;
  name: string;
  type: 'index' | 'file' | 'journal';
}

export function MemoryBrowser({ workspaceDir, onResync, isSyncing }: MemoryBrowserProps) {
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['files', 'journal']));
  const [syncStatus, setSyncStatus] = useState<{ initialized: boolean; lastSync: number; fileCount: number } | null>(null);

  // Load memory files list
  useEffect(() => {
    const loadFiles = async () => {
      setIsLoading(true);
      try {
        const status = await getSyncStatus(workspaceDir);
        setSyncStatus(status);

        if (!status.initialized) {
          setMemoryFiles([]);
          setIsLoading(false);
          return;
        }

        const files = await listMemoryFiles(workspaceDir);
        
        const parsed: MemoryFile[] = [
          { path: 'index.md', name: 'Project Overview', type: 'index' },
        ];

        // Add file summaries
        for (const file of files) {
          const name = file.replace('files/', '').replace('.md', '');
          parsed.push({
            path: file,
            name: formatFileName(name),
            type: 'file',
          });
        }

        // Try to load journal entries
        try {
          const journalContent = await readMemoryFile(workspaceDir, 'journal');
          // Journal entries are date-based files in journal/ folder
          // We'll detect them by trying to read recent dates
          const today = new Date();
          for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const journalPath = `journal/${dateStr}.md`;
            const content = await readMemoryFile(workspaceDir, journalPath);
            if (content) {
              parsed.push({
                path: journalPath,
                name: dateStr,
                type: 'journal',
              });
            }
          }
        } catch {
          // No journal entries
        }

        setMemoryFiles(parsed);
      } catch (err) {
        console.error('Failed to load memory files:', err);
        setMemoryFiles([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadFiles();
  }, [workspaceDir, isSyncing]);

  // Load file content when selected
  useEffect(() => {
    if (!selectedFile) {
      setFileContent(null);
      return;
    }

    const loadContent = async () => {
      try {
        const content = await readMemoryFile(workspaceDir, selectedFile);
        setFileContent(content);
      } catch (err) {
        console.error('Failed to load file content:', err);
        setFileContent(null);
      }
    };

    loadContent();
  }, [selectedFile, workspaceDir]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return memoryFiles;
    const q = searchQuery.toLowerCase();
    return memoryFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [memoryFiles, searchQuery]);

  const indexFile = filteredFiles.find((f) => f.type === 'index');
  const summaryFiles = filteredFiles.filter((f) => f.type === 'file');
  const journalFiles = filteredFiles.filter((f) => f.type === 'journal');

  const formatLastSync = (timestamp: number) => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  // Not initialized state
  if (!isLoading && !syncStatus?.initialized) {
    return (
      <div className="memory-browser">
        <div className="memory-empty">
          <Brain size={24} />
          <span className="memory-empty-title">No Memory Yet</span>
          <span className="memory-empty-text">
            Index your workspace to build semantic memory
          </span>
          <button
            className="memory-empty-btn"
            onClick={onResync}
            disabled={isSyncing}
          >
            <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Indexing...' : 'Index Workspace'}
          </button>
        </div>
      </div>
    );
  }

  // File viewer mode
  if (selectedFile && fileContent !== null) {
    return (
      <div className="memory-browser">
        <div className="memory-viewer-header">
          <button className="memory-back-btn" onClick={() => setSelectedFile(null)}>
            <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
            Back
          </button>
          <span className="memory-viewer-title">
            {memoryFiles.find((f) => f.path === selectedFile)?.name || selectedFile}
          </span>
        </div>
        <div className="memory-viewer-content">
          <div className="markdown-content">
            {fileContent.split('\n').map((line, i) => {
              if (line.startsWith('# ')) {
                return <h1 key={i}>{line.slice(2)}</h1>;
              }
              if (line.startsWith('## ')) {
                return <h2 key={i}>{line.slice(3)}</h2>;
              }
              if (line.startsWith('### ')) {
                return <h3 key={i}>{line.slice(4)}</h3>;
              }
              if (line.startsWith('- ')) {
                return <li key={i}>{line.slice(2)}</li>;
              }
              if (line.startsWith('```')) {
                return null; // Skip code fences for now
              }
              if (line.trim() === '') {
                return <br key={i} />;
              }
              return <p key={i}>{line}</p>;
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="memory-browser">
      {/* Header with sync info */}
      <div className="memory-header">
        <div className="memory-header-info">
          <span className="memory-header-count">{syncStatus?.fileCount || 0} files</span>
          <span className="memory-header-dot">•</span>
          <span className="memory-header-sync">{formatLastSync(syncStatus?.lastSync || 0)}</span>
        </div>
        <button
          className="memory-refresh-btn"
          onClick={onResync}
          disabled={isSyncing}
          title="Re-index workspace"
        >
          <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <div className="memory-search">
        <Search size={12} className="memory-search-icon" />
        <input
          type="text"
          placeholder="Search memory..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="memory-search-input"
        />
        {searchQuery && (
          <button className="memory-search-clear" onClick={() => setSearchQuery('')}>
            <X size={10} />
          </button>
        )}
      </div>

      {/* File tree */}
      <div className="memory-tree">
        {isLoading ? (
          <div className="memory-loading">
            <div className="memory-loading-spinner" />
            <span>Loading memory...</span>
          </div>
        ) : (
          <>
            {/* Index file */}
            {indexFile && (
              <div
                className={`memory-item memory-item-index ${selectedFile === indexFile.path ? 'active' : ''}`}
                onClick={() => setSelectedFile(indexFile.path)}
              >
                <Brain size={14} className="memory-item-icon" />
                <span className="memory-item-name">{indexFile.name}</span>
              </div>
            )}

            {/* File summaries section */}
            {summaryFiles.length > 0 && (
              <div className="memory-section">
                <div
                  className="memory-section-header"
                  onClick={() => toggleSection('files')}
                >
                  {expandedSections.has('files') ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <FolderOpen size={12} />
                  <span>File Summaries</span>
                  <span className="memory-section-count">{summaryFiles.length}</span>
                </div>
                {expandedSections.has('files') && (
                  <div className="memory-section-content">
                    {summaryFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`memory-item ${selectedFile === file.path ? 'active' : ''}`}
                        onClick={() => setSelectedFile(file.path)}
                      >
                        <FileText size={12} className="memory-item-icon" />
                        <span className="memory-item-name">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Journal entries section */}
            {journalFiles.length > 0 && (
              <div className="memory-section">
                <div
                  className="memory-section-header"
                  onClick={() => toggleSection('journal')}
                >
                  {expandedSections.has('journal') ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <BookOpen size={12} />
                  <span>Journal</span>
                  <span className="memory-section-count">{journalFiles.length}</span>
                </div>
                {expandedSections.has('journal') && (
                  <div className="memory-section-content">
                    {journalFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`memory-item ${selectedFile === file.path ? 'active' : ''}`}
                        onClick={() => setSelectedFile(file.path)}
                      >
                        <BookOpen size={12} className="memory-item-icon" />
                        <span className="memory-item-name">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {filteredFiles.length === 0 && searchQuery && (
              <div className="memory-no-results">
                <span>No matches for "{searchQuery}"</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Convert slugified filename back to readable name */
function formatFileName(slug: string): string {
  return slug
    .replace(/-/g, '/')
    .replace(/_/g, ' ')
    .replace(/\.(ts|tsx|js|jsx|md|json|py|go|rs)$/i, '');
}
