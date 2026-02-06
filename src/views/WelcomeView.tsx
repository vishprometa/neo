import {
  AlertCircle,
  Sun,
  Moon,
  Monitor,
  Settings as SettingsIcon,
  Folder,
  Clock,
} from 'lucide-react';
import { NeoLogo } from '../components/NeoLogo';
import type { ThemeMode } from '../hooks';

interface WelcomeViewProps {
  apiKey: string | null;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onOpenSettings: () => void;
  onSelectFolder: () => void;
  recentFolders: string[];
  onOpenRecentFolder: (path: string) => void;
}

export function WelcomeView({
  apiKey,
  theme,
  onThemeChange,
  onOpenSettings,
  onSelectFolder,
  recentFolders,
  onOpenRecentFolder,
}: WelcomeViewProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-corner">
        <div className="theme-toggle">
          <button
            onClick={() => onThemeChange('dark')}
            className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
            title="Dark theme"
          >
            <Moon size={12} />
          </button>
          <button
            onClick={() => onThemeChange('light')}
            className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
            title="Light theme"
          >
            <Sun size={12} />
          </button>
          <button
            onClick={() => onThemeChange('system')}
            className={`theme-toggle-btn ${theme === 'system' ? 'active' : ''}`}
            title="System theme"
          >
            <Monitor size={12} />
          </button>
        </div>
        <button
          onClick={onOpenSettings}
          className="titlebar-btn"
          title="Settings"
        >
          <SettingsIcon size={14} />
        </button>
      </div>

      <div className="welcome-content">
        <NeoLogo width={320} className="welcome-logo" />
        <p className="welcome-subtitle">AI Coding Assistant</p>
        <p className="welcome-subtitle-secondary">
          Index your workspace for semantic memory
        </p>

        {!apiKey && (
          <div className="welcome-warning">
            <AlertCircle size={14} />
            <span>Configure your OpenRouter API key in settings to get started.</span>
          </div>
        )}

        <button onClick={onSelectFolder} className="welcome-btn">
          <Folder size={16} />
          {apiKey ? 'Open Folder' : 'Configure API Key'}
        </button>

        <p className="welcome-hint">
          <kbd>⌘O</kbd> open folder &nbsp; <kbd>⌘N</kbd> new window
        </p>

        {recentFolders.length > 0 && (
          <div className="recent-folders">
            <div className="recent-folders-header">
              <Clock size={12} />
              <span>Recent</span>
            </div>
            <div className="recent-folders-list">
              {recentFolders.map((folder) => (
                <button
                  key={folder}
                  className="recent-folder-item"
                  onClick={() => onOpenRecentFolder(folder)}
                >
                  <Folder size={14} />
                  <span className="recent-folder-name">{folder.split('/').pop()}</span>
                  <span className="recent-folder-path">{folder}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
