import { useState, useEffect, useCallback } from 'react';
import { syncDirectory, isMemoryInitialized, getSyncStatus, type SyncProgress } from '../lib/memory';

interface MemoryStatus {
  initialized: boolean;
  lastSync: number;
  fileCount: number;
}

interface UseMemorySyncOptions {
  workspaceDir: string | null;
  apiKey: string | null;
  onError: (error: string) => void;
}

export function useMemorySync({ workspaceDir, apiKey, onError }: UseMemorySyncOptions) {
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);

  // Load memory status when workspace changes
  useEffect(() => {
    const loadMemoryStatus = async () => {
      if (!workspaceDir) {
        setMemoryStatus(null);
        return;
      }
      try {
        const status = await getSyncStatus(workspaceDir);
        setMemoryStatus(status);
      } catch {
        setMemoryStatus(null);
      }
    };
    loadMemoryStatus();
  }, [workspaceDir]);

  const syncOnOpen = useCallback(async (path: string) => {
    if (!apiKey) return;
    try {
      const initialized = await isMemoryInitialized(path);
      if (!initialized) {
        setIsSyncing(true);
        setSyncProgress({ phase: 'scanning', current: 0, total: 0 });
        try {
          await syncDirectory(path, apiKey, (progress) => setSyncProgress(progress));
        } catch (err) {
          console.error('Memory sync failed:', err);
        } finally {
          setIsSyncing(false);
          setSyncProgress(null);
        }
      }
    } catch (err) {
      console.error('Failed to check memory status:', err);
    }
  }, [apiKey]);

  const resync = useCallback(async () => {
    if (!workspaceDir) {
      onError('Select a workspace folder first before indexing.');
      return;
    }
    if (!apiKey) {
      onError('Set your Gemini API key in Settings before indexing.');
      return;
    }
    setIsSyncing(true);
    setSyncProgress({ phase: 'scanning', current: 0, total: 0 });
    try {
      const result = await syncDirectory(workspaceDir, apiKey, (progress) => setSyncProgress(progress));
      setSyncProgress({ phase: 'complete', current: result.indexed, total: result.indexed + result.skipped });
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error('Memory sync failed:', err);
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : JSON.stringify(err);
      onError(`Indexing failed: ${msg}`);
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      try {
        const status = await getSyncStatus(workspaceDir);
        setMemoryStatus(status);
      } catch {
        setMemoryStatus(null);
      }
    }
  }, [workspaceDir, apiKey, onError]);

  return {
    syncProgress,
    isSyncing,
    memoryStatus,
    syncOnOpen,
    resync,
  };
}
