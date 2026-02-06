import { useState, useCallback } from 'react';
import { Titlebar } from './components/Titlebar';
import { Settings } from './components/Settings';
import { WelcomeView } from './views/WelcomeView';
import { ChatView } from './views/ChatView';
import { useTheme, useFolderPicker, useKeyboardShortcuts, useWindowFocus, useMemorySync } from './hooks';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import './App.css';

function App() {
  // Core state
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(() => {
    return localStorage.getItem('neo_openrouter_api_key');
  });
  const [error, setError] = useState<string | null>(null);

  // Hooks
  const { theme, setTheme } = useTheme();
  const isFocused = useWindowFocus();

  // Memory sync (for initial sync on folder open)
  const { syncOnOpen } = useMemorySync({
    workspaceDir,
    apiKey,
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

  // Save API key
  const handleSaveApiKey = useCallback((key: string) => {
    localStorage.setItem('neo_openrouter_api_key', key);
    setApiKey(key);
    setShowSettings(false);
  }, []);

  // Settings view
  if (showSettings) {
    return (
      <div className={`app-container ${isFocused ? 'focused' : 'unfocused'}`}>
        <Titlebar isFocused={isFocused} onNewWindow={handleNewWindow} />
        <Settings
          currentApiKey={apiKey}
          onSave={handleSaveApiKey}
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
        apiKey={apiKey!}
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
