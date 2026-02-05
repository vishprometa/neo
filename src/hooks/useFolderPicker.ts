import { useState, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'neo_recent_folders';

interface UseFolderPickerOptions {
  apiKey: string | null;
  onFolderSelected: (path: string) => void;
  onError: (error: string) => void;
  onOpenSettings: () => void;
}

export function useFolderPicker({ apiKey, onFolderSelected, onError, onOpenSettings }: UseFolderPickerOptions) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  // Load recent folders from localStorage
  useEffect(() => {
    const storedFolders = localStorage.getItem(STORAGE_KEY);
    if (storedFolders) {
      try {
        setRecentFolders(JSON.parse(storedFolders));
      } catch {
        setRecentFolders([]);
      }
    }
  }, []);

  const addToRecentFolders = useCallback((path: string) => {
    setRecentFolders((prev) => {
      const updated = [path, ...prev.filter((p) => p !== path)].slice(0, 5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const grantFolderAccess = useCallback(async (path: string): Promise<boolean> => {
    try {
      await invoke('allow_workspace_dir', { path });
      return true;
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : JSON.stringify(err);
      onError(`Failed to grant folder access: ${msg}`);
      return false;
    }
  }, [onError]);

  const selectFolder = useCallback(async () => {
    if (!apiKey) {
      onOpenSettings();
      return null;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select a workspace folder',
      });
      if (selected && typeof selected === 'string') {
        const granted = await grantFolderAccess(selected);
        if (granted) {
          addToRecentFolders(selected);
          onFolderSelected(selected);
          return selected;
        }
      }
      return null;
    } catch (err) {
      console.error('Failed to select folder:', err);
      return null;
    }
  }, [apiKey, grantFolderAccess, addToRecentFolders, onFolderSelected, onOpenSettings]);

  const openRecentFolder = useCallback(async (path: string) => {
    const granted = await grantFolderAccess(path);
    if (granted) {
      addToRecentFolders(path);
      onFolderSelected(path);
    }
  }, [grantFolderAccess, addToRecentFolders, onFolderSelected]);

  return {
    recentFolders,
    selectFolder,
    openRecentFolder,
  };
}
