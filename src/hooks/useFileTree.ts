/**
 * Hook for building a file tree from the workspace directory
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { readDir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileItem[];
  path: string;
}

/** Patterns to ignore when building the file tree */
const IGNORE_PATTERNS = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.neomemory',
  'coverage',
  '.turbo',
  '.cache',
  'target',
  '.vscode',
  '.idea',
]);

interface UseFileTreeOptions {
  workspaceDir: string | null;
  /** Initial depth to load (default: 1 for lazy loading) */
  initialDepth?: number;
}

interface UseFileTreeReturn {
  files: FileItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  loadChildren: (folderPath: string) => Promise<FileItem[]>;
}

/**
 * Sort items: folders first, then alphabetically
 */
function sortItems(items: FileItem[]): FileItem[] {
  return items.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function useFileTree({ workspaceDir, initialDepth = 1 }: UseFileTreeOptions): UseFileTreeReturn {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const childrenCacheRef = useRef<Map<string, FileItem[]>>(new Map());

  /**
   * Read directory contents and build FileItem array
   */
  const readDirectory = useCallback(async (
    dirPath: string,
    relativePath: string,
    depth: number,
    maxDepth: number
  ): Promise<FileItem[]> => {
    try {
      const entries = await readDir(dirPath);
      const items: FileItem[] = [];

      for (const entry of entries) {
        // Skip hidden files and ignored patterns
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (IGNORE_PATTERNS.has(entry.name)) continue;

        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullPath = await join(dirPath, entry.name);

        const item: FileItem = {
          id: entryRelativePath,
          name: entry.name,
          type: entry.isDirectory ? 'folder' : 'file',
          path: entryRelativePath,
        };

        // Recursively load children if within depth limit
        if (entry.isDirectory && depth < maxDepth) {
          const children = await readDirectory(fullPath, entryRelativePath, depth + 1, maxDepth);
          item.children = children;
        }

        items.push(item);
      }

      return sortItems(items);
    } catch (err) {
      console.error(`Error reading directory ${dirPath}:`, err);
      return [];
    }
  }, []);

  /**
   * Load the initial file tree
   */
  const loadFileTree = useCallback(async () => {
    if (!workspaceDir) {
      setFiles([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    childrenCacheRef.current.clear();

    try {
      const tree = await readDirectory(workspaceDir, '', 0, initialDepth);
      setFiles(tree);
    } catch (err) {
      console.error('Error loading file tree:', err);
      setError(err instanceof Error ? err.message : 'Failed to load file tree');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceDir, initialDepth, readDirectory]);

  /**
   * Load children for a specific folder (lazy loading)
   */
  const loadChildren = useCallback(async (folderPath: string): Promise<FileItem[]> => {
    if (!workspaceDir) return [];

    // Check cache first
    const cached = childrenCacheRef.current.get(folderPath);
    if (cached) return cached;

    try {
      const fullPath = await join(workspaceDir, folderPath);
      const children = await readDirectory(fullPath, folderPath, 0, 1);
      
      // Cache the results
      childrenCacheRef.current.set(folderPath, children);

      // Update the tree with the loaded children
      setFiles(prevFiles => {
        const updateChildren = (items: FileItem[]): FileItem[] => {
          return items.map(item => {
            if (item.path === folderPath && item.type === 'folder') {
              return { ...item, children };
            }
            if (item.children) {
              return { ...item, children: updateChildren(item.children) };
            }
            return item;
          });
        };
        return updateChildren(prevFiles);
      });

      return children;
    } catch (err) {
      console.error(`Error loading children for ${folderPath}:`, err);
      return [];
    }
  }, [workspaceDir, readDirectory]);

  /**
   * Refresh the file tree
   */
  const refresh = useCallback(() => {
    loadFileTree();
  }, [loadFileTree]);

  // Load tree when workspace changes
  useEffect(() => {
    loadFileTree();
  }, [loadFileTree]);

  return {
    files,
    isLoading,
    error,
    refresh,
    loadChildren,
  };
}
