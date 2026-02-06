/**
 * Hook for file/directory suggestions in @ mentions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { readDir, exists, stat } from '@tauri-apps/plugin-fs';
import { join, basename, dirname } from '@tauri-apps/api/path';

export interface FileSuggestion {
  /** Display name */
  name: string;
  /** Full relative path from workspace */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File extension (if file) */
  extension?: string;
}

interface UseFileSuggestionsOptions {
  workspaceDir: string | null;
  /** Maximum suggestions to show */
  maxSuggestions?: number;
}

export function useFileSuggestions({ workspaceDir, maxSuggestions = 10 }: UseFileSuggestionsOptions) {
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cacheRef = useRef<Map<string, FileSuggestion[]>>(new Map());

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions]);

  /**
   * Get file icon based on extension
   */
  const getFileIcon = useCallback((name: string, isDirectory: boolean): string => {
    if (isDirectory) return '📁';
    
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return '🔷';
      case 'js':
      case 'jsx':
        return '🟨';
      case 'json':
        return '📋';
      case 'md':
        return '📝';
      case 'css':
      case 'scss':
        return '🎨';
      case 'html':
        return '🌐';
      case 'py':
        return '🐍';
      case 'rs':
        return '🦀';
      case 'go':
        return '🐹';
      default:
        return '📄';
    }
  }, []);

  /**
   * Search for files matching a query
   */
  const searchFiles = useCallback(async (query: string): Promise<void> => {
    if (!workspaceDir) {
      setSuggestions([]);
      return;
    }

    // Check cache first
    const cacheKey = query.toLowerCase();
    if (cacheRef.current.has(cacheKey)) {
      setSuggestions(cacheRef.current.get(cacheKey)!);
      return;
    }

    setIsLoading(true);

    try {
      const results: FileSuggestion[] = [];
      const searchLower = query.toLowerCase();
      
      // Determine search directory
      let searchDir = workspaceDir;
      let searchPattern = query;

      // If query contains '/', search in that subdirectory
      if (query.includes('/')) {
        const lastSlashIdx = query.lastIndexOf('/');
        const dirPart = query.slice(0, lastSlashIdx);
        searchPattern = query.slice(lastSlashIdx + 1);
        
        const potentialDir = await join(workspaceDir, dirPart);
        const dirExists = await exists(potentialDir);
        if (dirExists) {
          const dirStat = await stat(potentialDir);
          if (dirStat.isDirectory) {
            searchDir = potentialDir;
          }
        }
      }

      // Recursive search function
      async function scanDirectory(dir: string, relativePath: string, depth: number): Promise<void> {
        if (depth > 3 || results.length >= maxSuggestions * 2) return;

        try {
          const entries = await readDir(dir);
          
          for (const entry of entries) {
            if (results.length >= maxSuggestions * 2) break;

            // Skip hidden files and common ignored directories
            if (entry.name.startsWith('.')) continue;
            if (['node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__'].includes(entry.name)) {
              continue;
            }

            const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            const nameLower = entry.name.toLowerCase();
            const pathLower = entryPath.toLowerCase();

            // Match if name or path contains search pattern
            const matches = 
              searchPattern === '' ||
              nameLower.includes(searchPattern.toLowerCase()) ||
              pathLower.includes(searchPattern.toLowerCase());

            if (matches) {
              results.push({
                name: entry.name,
                path: entryPath,
                isDirectory: entry.isDirectory,
                extension: entry.isDirectory ? undefined : entry.name.split('.').pop(),
              });
            }

            // Recurse into directories
            if (entry.isDirectory && depth < 3) {
              const fullPath = await join(dir, entry.name);
              await scanDirectory(fullPath, entryPath, depth + 1);
            }
          }
        } catch {
          // Ignore permission errors
        }
      }

      await scanDirectory(searchDir, searchDir === workspaceDir ? '' : query.slice(0, query.lastIndexOf('/')), 0);

      // Sort results: directories first, then by relevance
      results.sort((a, b) => {
        // Exact matches first
        const aExact = a.name.toLowerCase() === searchLower;
        const bExact = b.name.toLowerCase() === searchLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // Starts with query next
        const aStarts = a.name.toLowerCase().startsWith(searchLower);
        const bStarts = b.name.toLowerCase().startsWith(searchLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        // Directories before files
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;

        // Shorter paths first
        return a.path.length - b.path.length;
      });

      // Take top results
      const topResults = results.slice(0, maxSuggestions);

      // Cache results
      cacheRef.current.set(cacheKey, topResults);

      setSuggestions(topResults);
    } catch (err) {
      console.error('Error searching files:', err);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceDir, maxSuggestions]);

  /**
   * Clear suggestions
   */
  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setSelectedIndex(0);
  }, []);

  /**
   * Navigate selection
   */
  const selectNext = useCallback(() => {
    setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
  }, [suggestions.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex(prev => Math.max(prev - 1, 0));
  }, []);

  /**
   * Clear cache (e.g., when workspace changes)
   */
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  // Clear cache when workspace changes
  useEffect(() => {
    clearCache();
    clearSuggestions();
  }, [workspaceDir, clearCache, clearSuggestions]);

  return {
    suggestions,
    isLoading,
    selectedIndex,
    setSelectedIndex,
    searchFiles,
    clearSuggestions,
    selectNext,
    selectPrev,
    getFileIcon,
    clearCache,
  };
}
