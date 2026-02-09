/**
 * Hook to detect installed code editors on the user's system.
 * Uses `which` to check for CLI commands, the opener plugin to launch apps,
 * and a Tauri command to extract real app icons.
 */

import { useState, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';

export interface DetectedEditor {
  id: string;
  name: string;
  /** CLI command to open a folder */
  command: string;
  /** macOS app name for `open -a` / openPath */
  appName: string;
  /** Whether this editor was found on the system */
  available: boolean;
  /** Base64 data URL of the app icon (loaded async) */
  iconDataUrl?: string;
}

const EDITORS_TO_CHECK: Omit<DetectedEditor, 'available' | 'iconDataUrl'>[] = [
  { id: 'vscode', name: 'VS Code', command: 'code', appName: 'Visual Studio Code' },
  { id: 'cursor', name: 'Cursor', command: 'cursor', appName: 'Cursor' },
  { id: 'zed', name: 'Zed', command: 'zed', appName: 'Zed' },
  { id: 'sublime', name: 'Sublime Text', command: 'subl', appName: 'Sublime Text' },
  { id: 'windsurf', name: 'Windsurf', command: 'windsurf', appName: 'Windsurf' },
];

async function checkCommandExists(cmd: string): Promise<boolean> {
  try {
    const result = await Command.create('sh', ['-c', `which ${cmd}`]).execute();
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function useEditorDetection() {
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const results = await Promise.all(
        EDITORS_TO_CHECK.map(async (editor) => ({
          ...editor,
          available: await checkCommandExists(editor.command),
        }))
      );

      const available = results.filter((e) => e.available);

      if (!cancelled) {
        setEditors(available);
        setIsLoading(false);
      }

      // Load icons async after initial render
      const withIcons = await Promise.all(
        available.map(async (editor) => {
          try {
            const iconDataUrl = await invoke<string>('get_app_icon', {
              appName: editor.appName,
            });
            return { ...editor, iconDataUrl };
          } catch {
            return editor;
          }
        })
      );

      if (!cancelled) {
        setEditors(withIcons);
      }
    }

    detect();
    return () => { cancelled = true; };
  }, []);

  const openInEditor = async (editor: DetectedEditor, folderPath: string) => {
    try {
      // Use the opener plugin with the macOS app name
      await openPath(folderPath, editor.appName);
    } catch (err) {
      // Fallback to CLI command
      try {
        await Command.create('sh', ['-c', `${editor.command} "${folderPath}"`]).execute();
      } catch (err2) {
        console.error(`Failed to open in ${editor.name}:`, err2);
      }
    }
  };

  const openInFinder = async (folderPath: string) => {
    try {
      await revealItemInDir(folderPath);
    } catch (err) {
      console.error('Failed to open in Finder:', err);
    }
  };

  const openInTerminal = async (folderPath: string) => {
    try {
      await openPath(folderPath, 'Terminal');
    } catch (err) {
      console.error('Failed to open Terminal:', err);
    }
  };

  // Load Finder and Terminal icons
  const [finderIcon, setFinderIcon] = useState<string | undefined>();
  const [terminalIcon, setTerminalIcon] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const icon = await invoke<string>('get_app_icon', { appName: 'Finder' });
        setFinderIcon(icon);
      } catch { /* ignore */ }
    })();
    (async () => {
      try {
        const icon = await invoke<string>('get_app_icon', { appName: 'Terminal' });
        setTerminalIcon(icon);
      } catch { /* ignore */ }
    })();
  }, []);

  return { editors, isLoading, openInEditor, openInFinder, openInTerminal, finderIcon, terminalIcon };
}
