import { useState, useEffect, useCallback, useRef } from 'react';
import { syncDirectory, isMemoryInitialized, getSyncStatus, type SyncProgress } from '../lib/memory';
import type { ProviderConfig } from '../lib/llm';

interface MemoryStatus {
  initialized: boolean;
  lastSync: number;
  fileCount: number;
}

export type LogEntry = {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
};

interface UseMemorySyncOptions {
  workspaceDir: string | null;
  providerConfig: ProviderConfig | null;
  onError: (error: string) => void;
  onLog?: (entry: LogEntry) => void;
}

export function useMemorySync({ workspaceDir, providerConfig, onError, onLog }: UseMemorySyncOptions) {
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    if (onLog) {
      onLog({
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        level,
        message,
      });
    }
  }, [onLog]);

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
    if (!providerConfig) return;
    if (isSyncing) return;
    try {
      const initialized = await isMemoryInitialized(path);
      if (!initialized) {
        addLog('info', 'Starting initial workspace indexing...');
        setIsSyncing(true);
        setSyncProgress({ phase: 'scanning', current: 0, total: 0 });
        abortControllerRef.current = new AbortController();
        try {
          await syncDirectory(
            path,
            providerConfig,
            (progress) => setSyncProgress(progress),
            abortControllerRef.current.signal,
            addLog
          );
          addLog('success', 'Initial indexing completed successfully');
        } catch (err) {
          console.error('Memory sync failed:', err);
          if ((err as Error).name === 'AbortError') {
            addLog('warning', 'Indexing was stopped');
          } else {
            addLog('error', `Indexing failed: ${(err as Error).message}`);
          }
        } finally {
          setIsSyncing(false);
          setSyncProgress(null);
          abortControllerRef.current = null;
        }
      }
    } catch (err) {
      console.error('Failed to check memory status:', err);
      addLog('error', `Failed to check memory status: ${(err as Error).message}`);
    }
  }, [providerConfig, addLog, isSyncing]);

  const resync = useCallback(async () => {
    if (!workspaceDir) {
      onError('Select a workspace folder first before indexing.');
      return;
    }
    if (!providerConfig) {
      onError(`Set your API key in Settings before indexing.`);
      return;
    }
    if (isSyncing) {
      addLog('warning', 'Indexing is already running.');
      return;
    }
    addLog('info', `Starting indexing of workspace: ${workspaceDir}`);
    setIsSyncing(true);
    setSyncProgress({ phase: 'scanning', current: 0, total: 0 });
    abortControllerRef.current = new AbortController();
    try {
      const result = await syncDirectory(workspaceDir, providerConfig, (progress) => {
        setSyncProgress(progress);
        if (progress.currentFile) {
          addLog('info', `Processing: ${progress.currentFile}`);
        }
      }, abortControllerRef.current.signal, addLog);
      setSyncProgress({ phase: 'complete', current: result.indexed, total: result.indexed + result.skipped });
      addLog('success', `Indexing complete: ${result.indexed} files indexed, ${result.skipped} skipped`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error('Memory sync failed:', err);
      if ((err as Error).name === 'AbortError') {
        addLog('warning', 'Indexing was stopped by user');
      } else {
        const msg = err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : JSON.stringify(err);
        onError(`Indexing failed: ${msg}`);
        addLog('error', `Indexing failed: ${msg}`);
      }
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      abortControllerRef.current = null;
      try {
        const status = await getSyncStatus(workspaceDir);
        setMemoryStatus(status);
      } catch {
        setMemoryStatus(null);
      }
    }
  }, [workspaceDir, providerConfig, onError, addLog, isSyncing]);

  const stopSync = useCallback(() => {
    if (abortControllerRef.current) {
      addLog('warning', 'Stopping indexing...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [addLog]);

  return {
    syncProgress,
    isSyncing,
    memoryStatus,
    syncOnOpen,
    resync,
    stopSync,
  };
}
