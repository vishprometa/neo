import { useState, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'neo_recent_folders';
const PERMISSIONS_KEY = 'neo_edit_permissions';

const normalizePath = (path: string) => {
  if (path.length > 1) {
    return path.replace(/[\\/]+$/, '');
  }
  return path;
};

interface UseFolderPickerOptions {
  apiKey: string | null;
  onFolderSelected: (path: string) => void;
  onError: (error: string) => void;
  onOpenSettings: () => void;
}

export function useFolderPicker({ apiKey, onFolderSelected, onError, onOpenSettings }: UseFolderPickerOptions) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [approvedFolders, setApprovedFolders] = useState<string[]>([]);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);

  // Load recent folders from localStorage
  useEffect(() => {
    const storedFolders = localStorage.getItem(STORAGE_KEY);
    if (storedFolders) {
      try {
        const parsed = JSON.parse(storedFolders);
        if (Array.isArray(parsed)) {
          setRecentFolders(parsed.map(normalizePath));
        } else {
          setRecentFolders([]);
        }
      } catch {
        setRecentFolders([]);
      }
    }
  }, []);

  // Load persisted edit permissions
  useEffect(() => {
    const storedPermissions = localStorage.getItem(PERMISSIONS_KEY);
    if (storedPermissions) {
      try {
        const parsed = JSON.parse(storedPermissions);
        if (Array.isArray(parsed)) {
          setApprovedFolders(parsed.map(normalizePath));
        }
      } catch {
        setApprovedFolders([]);
      }
    }
  }, []);

  const addToRecentFolders = useCallback((path: string) => {
    setRecentFolders((prev) => {
      const normalized = normalizePath(path);
      const updated = [normalized, ...prev.filter((p) => normalizePath(p) !== normalized)].slice(0, 5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const addApprovedFolder = useCallback((path: string) => {
    setApprovedFolders((prev) => {
      const normalized = normalizePath(path);
      if (prev.includes(normalized)) {
        return prev;
      }
      const updated = [normalized, ...prev];
      localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const grantFolderAccess = useCallback(async (path: string): Promise<boolean> => {
    try {
      await invoke('allow_workspace_dir', { path: normalizePath(path) });
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

  const openFolderAfterGrant = useCallback(async (path: string) => {
    const granted = await grantFolderAccess(path);
    if (granted) {
      addToRecentFolders(path);
      onFolderSelected(path);
    }
  }, [grantFolderAccess, addToRecentFolders, onFolderSelected]);

  const requestEditPermission = useCallback(async (path: string) => {
    const normalized = normalizePath(path);
    if (approvedFolders.includes(normalized)) {
      await openFolderAfterGrant(normalized);
      return;
    }
    setPendingFolder(normalized);
  }, [approvedFolders, openFolderAfterGrant]);

  const confirmEditPermission = useCallback(async () => {
    if (!pendingFolder) return;
    const path = pendingFolder;
    setPendingFolder(null);
    const granted = await grantFolderAccess(path);
    if (granted) {
      addApprovedFolder(path);
      addToRecentFolders(path);
      onFolderSelected(path);
    }
  }, [pendingFolder, grantFolderAccess, addApprovedFolder, addToRecentFolders, onFolderSelected]);

  const cancelEditPermission = useCallback(() => {
    setPendingFolder(null);
  }, []);

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
        await requestEditPermission(selected);
        return selected;
      }
      return null;
    } catch (err) {
      console.error('Failed to select folder:', err);
      return null;
    }
  }, [apiKey, requestEditPermission, onOpenSettings]);

  const openRecentFolder = useCallback(async (path: string) => {
    await requestEditPermission(path);
  }, [requestEditPermission]);

  return {
    recentFolders,
    selectFolder,
    openRecentFolder,
    pendingFolder,
    confirmEditPermission,
    cancelEditPermission,
  };
}
