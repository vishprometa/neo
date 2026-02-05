import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'neo_theme_mode';

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>('dark');

  const applyTheme = useCallback((mode: ThemeMode) => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    root.classList.toggle('dark', isDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, []);

  // Initialize theme from localStorage
  useEffect(() => {
    const storedTheme = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (storedTheme) {
      setTheme(storedTheme);
      applyTheme(storedTheme);
    } else {
      applyTheme('dark');
    }
  }, [applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    media?.addEventListener?.('change', handleChange);
    return () => media?.removeEventListener?.('change', handleChange);
  }, [theme, applyTheme]);

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    setTheme(mode);
    applyTheme(mode);
  }, [applyTheme]);

  return {
    theme,
    setTheme: handleThemeChange,
  };
}
