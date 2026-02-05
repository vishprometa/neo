import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface AppContextValue {
  // API Key
  apiKey: string | null;
  setApiKey: (key: string) => void;
  
  // Workspace
  workspaceDir: string | null;
  setWorkspaceDir: (dir: string | null) => void;
  
  // Settings
  showSettings: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  
  // Error
  error: string | null;
  setError: (error: string | null) => void;
  
  // New window
  createNewWindow: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const API_KEY_STORAGE = 'neo_gemini_api_key';

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load API key from localStorage
  useEffect(() => {
    const storedKey = localStorage.getItem(API_KEY_STORAGE);
    if (storedKey) setApiKeyState(storedKey);
  }, []);

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem(API_KEY_STORAGE, key);
    setApiKeyState(key);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  const createNewWindow = useCallback(async () => {
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

  return (
    <AppContext.Provider
      value={{
        apiKey,
        setApiKey,
        workspaceDir,
        setWorkspaceDir,
        showSettings,
        openSettings,
        closeSettings,
        error,
        setError,
        createNewWindow,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
