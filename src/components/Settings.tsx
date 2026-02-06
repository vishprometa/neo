import { useState } from 'react';
import { X, Key, Eye, EyeOff, ExternalLink, Moon, Sun, Monitor } from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsProps {
  currentApiKey: string | null;
  onSave: (key: string) => void;
  onCancel: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export function Settings({ currentApiKey, onSave, onCancel, theme, onThemeChange }: SettingsProps) {
  const [apiKey, setApiKey] = useState(currentApiKey || '');
  const [showKey, setShowKey] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim()) {
      onSave(apiKey.trim());
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <button onClick={onCancel} className="settings-close">
          <X size={14} />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Theme Section */}
        <div className="settings-section">
          <label className="settings-label">Theme</label>
          <div className="theme-toggle" style={{ width: 'fit-content' }}>
            <button
              type="button"
              onClick={() => onThemeChange('dark')}
              className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
              title="Dark"
            >
              <Moon size={14} />
            </button>
            <button
              type="button"
              onClick={() => onThemeChange('light')}
              className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
              title="Light"
            >
              <Sun size={14} />
            </button>
            <button
              type="button"
              onClick={() => onThemeChange('system')}
              className={`theme-toggle-btn ${theme === 'system' ? 'active' : ''}`}
              title="System"
            >
              <Monitor size={14} />
            </button>
          </div>
        </div>

        {/* API Key Section */}
        <div className="settings-section">
          <label className="settings-label" htmlFor="apiKey">
            <Key size={12} style={{ display: 'inline', marginRight: '6px' }} />
            OpenRouter API Key
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="apiKey"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your OpenRouter API key (sk-or-v1-...)"
              className="settings-input"
              style={{ paddingRight: '36px' }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
              }}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '6px' }}>
            Get your API key from{' '}
            <a 
              href="https://openrouter.ai/keys" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: 'hsl(212 92% 55%)', textDecoration: 'none' }}
            >
              OpenRouter <ExternalLink size={10} style={{ display: 'inline' }} />
            </a>
            {' '}(uses Google Gemini models)
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
          <button type="button" onClick={onCancel} className="settings-btn settings-btn-secondary" style={{ flex: 1 }}>
            Cancel
          </button>
          <button type="submit" disabled={!apiKey.trim()} className="settings-btn" style={{ flex: 1 }}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
