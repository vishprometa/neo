import { useState, useCallback, useEffect, useRef } from 'react';
import { Titlebar } from './components/Titlebar';
import { Settings } from './components/Settings';
import { FolderAccessDialog } from './components/FolderAccessDialog';
import { WelcomeView } from './views/WelcomeView';
import { ChatView } from './views/ChatView';
import { LogsWindow } from './views/LogsWindow';
import { useTheme, useFolderPicker, useKeyboardShortcuts, useWindowFocus, useMemorySync } from './hooks';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import type { LLMProvider, ProviderConfig } from './lib/llm';
import type { LogEntry } from './hooks/useMemorySync';
import './App.css';

const STORAGE_KEY_API_KEY = 'neo_api_key';
const STORAGE_KEY_PROVIDER = 'neo_provider';

/** Read workspace path from URL query param (set when spawning workspace windows). */
function getInitialWorkspace(): string | null {
  const params = new URLSearchParams(window.location.search);
  const ws = params.get('workspace');
  return ws || null;
}

/** Shared window options matching tauri.conf.json main window config. */
const WINDOW_DEFAULTS = {
  width: 1000,
  height: 700,
  minWidth: 600,
  minHeight: 400,
  decorations: false,
  transparent: true,
  center: true,
  acceptFirstMouse: true,
} as const;

/** Spawn a new window scoped to the given workspace directory. */
function openWorkspaceWindow(path: string) {
  const label = `neo-${Date.now()}`;
  const win = new WebviewWindow(label, {
    ...WINDOW_DEFAULTS,
    url: `/?workspace=${encodeURIComponent(path)}`,
  });
  win.once('tauri://error', (e) => {
    console.error('Failed to create workspace window:', e);
  });
}

function App() {
  const isLogsWindow = new URLSearchParams(window.location.search).get('logs') === '1';

  // Core state — workspace is set from URL param when this is a workspace window
  const [workspaceDir] = useState<string | null>(getInitialWorkspace);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_API_KEY);
  });
  const [provider, setProvider] = useState<LLMProvider>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_PROVIDER);
    return (stored === 'gemini' || stored === 'openrouter') ? stored : 'gemini';
  });
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    try {
      const raw = localStorage.getItem('neo_logs');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const LOG_STORAGE_KEY = 'neo_logs';

  // Provider config for use by other components
  const providerConfig: ProviderConfig | null = apiKey 
    ? { provider, apiKey } 
    : null;

  // Hooks
  const { theme, setTheme } = useTheme();
  const isFocused = useWindowFocus();

  // Log handler
  const handleLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => {
      const updated = [...prev, entry].slice(-500);
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  if (isLogsWindow) {
    return <LogsWindow />;
  }

  // Memory sync (single shared instance)
  const {
    syncOnOpen,
    syncProgress,
    isSyncing,
    memoryStatus,
    resync,
    stopSync,
  } = useMemorySync({
    workspaceDir,
    providerConfig,
    onError: setError,
    onLog: handleLog,
  });

  // When workspace comes from URL param, scope FS access and trigger sync on mount
  const initRef = useRef(false);
  useEffect(() => {
    if (!workspaceDir || initRef.current) return;
    initRef.current = true;
    (async () => {
      try {
        await invoke('allow_workspace_dir', { path: workspaceDir });
      } catch (err) {
        console.error('Failed to scope workspace directory:', err);
      }
      await syncOnOpen(workspaceDir);
    })();
  }, [workspaceDir, syncOnOpen]);

  // Folder selection — opens a new window for the workspace
  const handleFolderSelected = useCallback((path: string) => {
    openWorkspaceWindow(path);
  }, []);

  const {
    recentFolders,
    selectFolder,
    openRecentFolder,
    pendingFolder,
    confirmEditPermission,
    cancelEditPermission,
  } = useFolderPicker({
    apiKey,
    onFolderSelected: handleFolderSelected,
    onError: setError,
    onOpenSettings: () => setShowSettings(true),
  });

  // New window (welcome screen)
  const handleNewWindow = useCallback(async () => {
    try {
      const label = `neo-${Date.now()}`;
      const win = new WebviewWindow(label, {
        ...WINDOW_DEFAULTS,
        url: '/',
      });
      win.once('tauri://error', (e) => {
        console.error('Failed to create window:', e);
      });
    } catch (err) {
      console.error('Failed to create new window:', err);
    }
  }, []);

  // Keyboard shortcuts — Cmd+O always available (opens in new window)
  useKeyboardShortcuts({
    onOpenFolder: selectFolder,
    onNewWindow: handleNewWindow,
  });

  // Save API key and provider
  const handleSaveSettings = useCallback((key: string, newProvider: LLMProvider) => {
    localStorage.setItem(STORAGE_KEY_API_KEY, key);
    localStorage.setItem(STORAGE_KEY_PROVIDER, newProvider);
    setApiKey(key);
    setProvider(newProvider);
    setShowSettings(false);
  }, []);

  // Settings view
  if (showSettings) {
    return (
      <div className={`app-container ${isFocused ? 'focused' : 'unfocused'}`}>
        <Titlebar isFocused={isFocused} />
        <Settings
          currentApiKey={apiKey}
          currentProvider={provider}
          onSave={handleSaveSettings}
          onCancel={() => setShowSettings(false)}
          theme={theme}
          onThemeChange={setTheme}
        />
      </div>
    );
  }

  // Welcome/folder picker view
  if (!workspaceDir) {
    return (
      <div className={`app-container ${isFocused ? 'focused' : 'unfocused'}`}>
        <Titlebar isFocused={isFocused} />
        <WelcomeView
          apiKey={apiKey}
          provider={provider}
          theme={theme}
          onThemeChange={setTheme}
          onOpenSettings={() => setShowSettings(true)}
          onSelectFolder={selectFolder}
          recentFolders={recentFolders}
          onOpenRecentFolder={openRecentFolder}
        />
        <FolderAccessDialog
          isOpen={Boolean(pendingFolder)}
          folderPath={pendingFolder}
          onConfirm={confirmEditPermission}
          onCancel={cancelEditPermission}
        />
      </div>
    );
  }

  // Main chat view
  return (
    <div className={`app-container ${isFocused ? 'focused' : 'unfocused'}`}>
      <ChatView
        workspaceDir={workspaceDir}
        providerConfig={providerConfig!}
        isFocused={isFocused}
        onOpenSettings={() => setShowSettings(true)}
        onNewWindow={handleNewWindow}
        error={error}
        setError={setError}
        logs={logs}
        onLog={handleLog}
        syncProgress={syncProgress}
        isSyncing={isSyncing}
        memoryStatus={memoryStatus}
        resync={resync}
        stopSync={stopSync}
      />
    </div>
  );
}

export default App;
