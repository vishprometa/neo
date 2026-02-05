import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  onOpenFolder?: () => void;
  onNewWindow?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onOpenFolder,
  onNewWindow,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘O or Ctrl+O to open folder
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        onOpenFolder?.();
      }
      // ⌘N or Ctrl+N to open new window
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        onNewWindow?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenFolder, onNewWindow, enabled]);
}
