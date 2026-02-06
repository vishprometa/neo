import { useState, useCallback } from 'react';
import { Titlebar } from './components/Titlebar';
import { Settings } from './components/Settings';
import { WelcomeView } from './views/WelcomeView';
import { ChatView } from './views/ChatView';
import { useTheme, useFolderPicker, useKeyboardShortcuts, useWindowFocus, useMemorySync } from './hooks';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { LLMProvider, ProviderConfig } from './lib/llm';
import './App.css';

const STORAGE_KEY_API_KEY = 'neo_api_key';
const STORAGE_KEY_PROVIDER = 'neo_provider';

function App() {
  // Core state
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_API_KEY);
  });
  const [provider, setProvider] = useState<LLMProvider>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_PROVIDER);
    return (stored === 'gemini' || stored === 'openrouter') ? stored : 'gemini';
  });
  const [error, setError] = useState<string | null>(null);

  // Provider config for use by other components
  const providerConfig: ProviderConfig | null = apiKey 
    ? { provider, apiKey } 
    : null;

  // Hooks
  const { theme, setTheme } = useTheme();
  const isFocused = useWindowFocus();

  // Memory sync (for initial sync on folder open)
  const { syncOnOpen } = useMemorySync({
    workspaceDir,
    providerConfig,
    onError: setError,
  });

  // Folder selection
  const handleFolderSelected = useCallback(async (path: string) => {
    setWorkspaceDir(path);
    await syncOnOpen(path);
  }, [syncOnOpen]);

  const { recentFolders, selectFolder, openRecentFolder } = useFolderPicker({
    apiKey,
    onFolderSelected: handleFolderSelected,
    onError: setError,
    onOpenSettings: () => setShowSettings(true),
  });

  // New window
  const handleNewWindow = useCallback(async () => {
    try {
      const label = `neo-${Date.now()}`;
      const win = new WebviewWindow(label, {
        url: '/',
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        decorations: false,
        center: true,
        acceptFirstMouse: true,
      });
      win.once('tauri://error', (e) => {
        console.error('Failed to create window:', e);
      });
    } catch (err) {
      console.error('Failed to create new window:', err);
    }
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onOpenFolder: !workspaceDir ? selectFolder : undefined,
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
        <Titlebar isFocused={isFocused} onNewWindow={handleNewWindow} />
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
        <Titlebar isFocused={isFocused} onNewWindow={handleNewWindow} />
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
      />
    </div>
  );
}

export default App;
