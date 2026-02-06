import { useState } from 'react';
import { X, Key, Eye, EyeOff, ExternalLink, Moon, Sun, Monitor, Zap, Globe } from 'lucide-react';
import { 
  type LLMProvider, 
  getProviderDisplayName, 
  getApiKeyPlaceholder, 
  getApiKeyUrl 
} from '../lib/llm';

type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsProps {
  currentApiKey: string | null;
  currentProvider: LLMProvider;
  onSave: (key: string, provider: LLMProvider) => void;
  onCancel: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export function Settings({ 
  currentApiKey, 
  currentProvider, 
  onSave, 
  onCancel, 
  theme, 
  onThemeChange 
}: SettingsProps) {
  const [apiKey, setApiKey] = useState(currentApiKey || '');
  const [provider, setProvider] = useState<LLMProvider>(currentProvider);
  const [showKey, setShowKey] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim()) {
      onSave(apiKey.trim(), provider);
    }
  };

  // Handle provider change - clear API key if switching providers
  const handleProviderChange = (newProvider: LLMProvider) => {
    if (newProvider !== provider) {
      setProvider(newProvider);
      // Keep the key if it was already set for this provider
      // Otherwise clear it
      setApiKey('');
    }
  };

  const apiKeyInfo = getApiKeyUrl(provider);

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

        {/* Provider Section */}
        <div className="settings-section">
          <label className="settings-label">LLM Provider</label>
          <div style={{ 
            display: 'flex', 
            gap: '8px',
            marginTop: '4px',
          }}>
            <button
              type="button"
              onClick={() => handleProviderChange('gemini')}
              title="Google Gemini (Direct)"
              style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '6px',
                border: provider === 'gemini' 
                  ? '1px solid hsl(var(--primary))' 
                  : '1px solid hsl(var(--border))',
                background: provider === 'gemini' 
                  ? 'hsl(var(--primary) / 0.1)' 
                  : 'transparent',
                color: provider === 'gemini' 
                  ? 'hsl(var(--primary))' 
                  : 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
            >
              <Zap size={14} />
              Gemini
            </button>
            <button
              type="button"
              onClick={() => handleProviderChange('openrouter')}
              title="OpenRouter"
              style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '6px',
                border: provider === 'openrouter' 
                  ? '1px solid hsl(var(--primary))' 
                  : '1px solid hsl(var(--border))',
                background: provider === 'openrouter' 
                  ? 'hsl(var(--primary) / 0.1)' 
                  : 'transparent',
                color: provider === 'openrouter' 
                  ? 'hsl(var(--primary))' 
                  : 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
            >
              <Globe size={14} />
              OpenRouter
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '8px' }}>
            {provider === 'gemini' 
              ? 'Free tier available • Uses Gemini 2.5 models directly'
              : 'More models available • Uses Gemini 3 Preview via OpenRouter'}
          </p>
        </div>

        {/* API Key Section */}
        <div className="settings-section">
          <label className="settings-label" htmlFor="apiKey">
            <Key size={12} style={{ display: 'inline', marginRight: '6px' }} />
            {getProviderDisplayName(provider)} API Key
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="apiKey"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={getApiKeyPlaceholder(provider)}
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
              href={apiKeyInfo.url}
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: 'hsl(212 92% 55%)', textDecoration: 'none' }}
            >
              {apiKeyInfo.label} <ExternalLink size={10} style={{ display: 'inline' }} />
            </a>
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
