/**
 * Memory service for Neo semantic filesystem
 * Manages .neomemory/ directory with indexed file summaries and journal entries
 */
import {
  readTextFile,
  writeTextFile,
  readDir,
  exists,
  mkdir,
  stat,
} from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { summarizeFilesBatch, summarizeDirectory } from './summarizer';
import type { ProviderConfig } from '../llm';
import { validateApiKey, getProviderDisplayName } from '../llm';

const MEMORY_DIR = '.neomemory';
const FILES_DIR = 'files';
const JOURNAL_DIR = 'journal';
const INDEX_FILE = 'index.md';
const MANIFEST_FILE = 'manifest.json';
const PROGRESS_FILE = 'progress.json';

/** File extensions to analyze */
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml',
  'toml', 'py', 'go', 'rs', 'html', 'css', 'scss', 'less',
  'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh',
  'sql', 'graphql', 'prisma', 'env', 'gitignore', 'dockerfile',
]);

/** Directories to skip during indexing */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.neomemory', 'dist', 'build', '.next',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target',
  '.turbo', '.vercel', '.output',
]);

/** Files to skip */
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock',
  'Cargo.lock', 'poetry.lock', 'composer.lock',
]);

export interface FileInfo {
  path: string;
  relativePath: string;
  modified: number;
  size: number;
  extension: string;
}

export interface ManifestEntry {
  path: string;
  modified: number;
  memoryFile: string;
  summarizedAt: number;
}

export interface Manifest {
  version: number;
  lastSync: number;
  entries: Record<string, ManifestEntry>;
}

export interface SyncProgress {
  phase: 'scanning' | 'summarizing' | 'indexing' | 'complete';
  current: number;
  total: number;
  currentFile?: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;
type LogLevel = 'info' | 'warning' | 'error' | 'success';
type LogFn = (level: LogLevel, message: string) => void;

/**
 * Get the .neomemory directory path for a workspace
 */
export async function getMemoryDir(workspaceDir: string): Promise<string> {
  return join(workspaceDir, MEMORY_DIR);
}

/**
 * Ensure .neomemory directory structure exists
 */
export async function ensureMemoryDir(workspaceDir: string): Promise<string> {
  const memoryDir = await getMemoryDir(workspaceDir);
  const filesDir = await join(memoryDir, FILES_DIR);
  const journalDir = await join(memoryDir, JOURNAL_DIR);

  if (!(await exists(memoryDir))) {
    await mkdir(memoryDir, { recursive: true });
  }
  if (!(await exists(filesDir))) {
    await mkdir(filesDir, { recursive: true });
  }
  if (!(await exists(journalDir))) {
    await mkdir(journalDir, { recursive: true });
  }

  return memoryDir;
}

/**
 * Load or create manifest
 */
async function loadManifest(memoryDir: string): Promise<Manifest> {
  const manifestPath = await join(memoryDir, MANIFEST_FILE);

  if (await exists(manifestPath)) {
    try {
      const content = await readTextFile(manifestPath);
      return JSON.parse(content);
    } catch {
      // Corrupted manifest, start fresh
    }
  }

  return {
    version: 1,
    lastSync: 0,
    entries: {},
  };
}

/**
 * Save manifest
 */
async function saveManifest(memoryDir: string, manifest: Manifest): Promise<void> {
  const manifestPath = await join(memoryDir, MANIFEST_FILE);
  await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
}

interface SyncProgressState {
  total: number;
  indexed: number;
  skipped: number;
  errors: number;
  indexedFiles: string[];
  remainingFiles: string[];
  lastUpdated: number;
}

async function saveProgress(memoryDir: string, state: SyncProgressState): Promise<void> {
  const progressPath = await join(memoryDir, PROGRESS_FILE);
  await writeTextFile(progressPath, JSON.stringify(state, null, 2));
}

/**
 * Generate a safe filename from a path
 */
function slugifyPath(relativePath: string): string {
  return relativePath
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .toLowerCase();
}

/**
 * Scan directory for indexable files
 */
async function scanDirectory(
  workspaceDir: string,
  onProgress?: SyncProgressCallback
): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  async function scan(dir: string, depth: number = 0): Promise<void> {
    if (depth > 15) return; // Prevent infinite recursion

    try {
      const entries = await readDir(dir);

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;

        const fullPath = await join(dir, entry.name);
        const relativePath = fullPath.slice(workspaceDir.length + 1);

        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await scan(fullPath, depth + 1);
        } else {
          if (SKIP_FILES.has(entry.name)) continue;

          const ext = entry.name.split('.').pop()?.toLowerCase() || '';
          if (!TEXT_EXTENSIONS.has(ext)) continue;

          try {
            const fileStat = await stat(fullPath);
            // Skip files larger than 500KB
            if (fileStat.size > 500 * 1024) continue;

            files.push({
              path: fullPath,
              relativePath,
              modified: fileStat.mtime?.getTime() || Date.now(),
              size: fileStat.size,
              extension: ext,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  onProgress?.({ phase: 'scanning', current: 0, total: 0 });
  await scan(workspaceDir);

  return files;
}

/**
 * Sync directory - main entry point for indexing
 */
export async function syncDirectory(
  workspaceDir: string,
  config: ProviderConfig,
  onProgress?: SyncProgressCallback,
  signal?: AbortSignal,
  onLog?: LogFn
): Promise<{ indexed: number; skipped: number; errors: number }> {
  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException('Sync operation was aborted', 'AbortError');
  }
  let memoryDir: string;
  try {
    memoryDir = await ensureMemoryDir(workspaceDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    throw new Error(`Failed to create .neomemory directory: ${msg}`);
  }

  const manifest = await loadManifest(memoryDir);
  const filesDir = await join(memoryDir, FILES_DIR);
  console.log(`[Memory] Starting sync for ${workspaceDir}`);
  onLog?.('info', `[Memory] Starting sync for ${workspaceDir}`);

  // Scan for files
  let files: FileInfo[];
  try {
    files = await scanDirectory(workspaceDir, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    throw new Error(`Failed to scan workspace: ${msg}`);
  }

  // Check if aborted after scanning
  if (signal?.aborted) {
    throw new DOMException('Sync operation was aborted', 'AbortError');
  }

  if (files.length === 0) {
    onProgress?.({ phase: 'complete', current: 0, total: 0 });
    manifest.lastSync = Date.now();
    await saveManifest(memoryDir, manifest);
    await saveProgress(memoryDir, {
      total: 0,
      indexed: 0,
      skipped: 0,
      errors: 0,
      indexedFiles: [],
      remainingFiles: [],
      lastUpdated: Date.now(),
    });
    return { indexed: 0, skipped: 0, errors: 0 };
  }

  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  // Process files that need updating
  const filesToProcess = files.filter((file) => {
    const existing = manifest.entries[file.relativePath];
    if (!existing) return true;
    return file.modified > existing.modified;
  });

  // Validate API key with a quick test if there are files to process
  if (filesToProcess.length > 0) {
    try {
      const isValid = await validateApiKey(config.provider, config.apiKey);
      if (!isValid) {
        throw new Error('API key validation failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      throw new Error(`${getProviderDisplayName(config.provider)} API key is invalid or API is unreachable: ${msg}`);
    }
  }

  console.log(`[Memory] Files total: ${files.length}, to index: ${filesToProcess.length}`);
  onLog?.('info', `[Memory] Files total: ${files.length}, to index: ${filesToProcess.length}`);

  onProgress?.({ phase: 'summarizing', current: 0, total: filesToProcess.length });

  // Read all file contents first
  const filesToSummarize: Array<{
    file: FileInfo;
    content: string;
  }> = [];

  for (const file of filesToProcess) {
    // Check if aborted during file reading
    if (signal?.aborted) {
      throw new DOMException('Sync operation was aborted', 'AbortError');
    }

    try {
      const content = await readTextFile(file.path);
      filesToSummarize.push({ file, content });
    } catch (err) {
      console.error(`Error reading ${file.relativePath}:`, err);
      onLog?.('error', `[Memory] Error reading ${file.relativePath}`);
      errors++;
    }
  }

  const indexedFiles: string[] = [];
  const remainingFiles = new Set(filesToSummarize.map(({ file }) => file.relativePath));
  await saveProgress(memoryDir, {
    total: filesToSummarize.length,
    indexed,
    skipped: files.length - filesToProcess.length,
    errors,
    indexedFiles,
    remainingFiles: Array.from(remainingFiles),
    lastUpdated: Date.now(),
  });

  // Batch summarize all files (handles rate limiting internally)
  if (filesToSummarize.length > 0) {
    let batchResult;
    try {
      batchResult = await summarizeFilesBatch(
        config,
        filesToSummarize.map(({ file, content }) => ({
          relativePath: file.relativePath,
          content,
          extension: file.extension,
        })),
        (processed, total) => {
          onProgress?.({
            phase: 'summarizing',
            current: processed,
            total,
            currentFile: filesToSummarize[Math.min(processed, filesToSummarize.length - 1)]?.file.relativePath,
          });
        },
        signal,
        onLog
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.('error', `[Memory] Summarization failed: ${msg}`);
      await saveProgress(memoryDir, {
        total: filesToSummarize.length,
        indexed,
        skipped: files.length - filesToProcess.length,
        errors: errors + filesToSummarize.length,
        indexedFiles,
        remainingFiles: Array.from(remainingFiles),
        lastUpdated: Date.now(),
      });
      throw err;
    }

    const errorByFile = new Map<string, string>();
    for (const err of batchResult.errors) {
      const splitIdx = err.indexOf(':');
      if (splitIdx > 0) {
        const path = err.slice(0, splitIdx).trim();
        const message = err.slice(splitIdx + 1).trim();
        errorByFile.set(path, message);
      }
    }

    // Write summaries and update manifest
    for (const { file } of filesToSummarize) {
      if (signal?.aborted) {
        throw new DOMException('Sync operation was aborted', 'AbortError');
      }
      const summary = batchResult.summaries.get(file.relativePath);
      if (summary) {
        try {
          const memoryFileName = slugifyPath(file.relativePath) + '.md';
          const memoryFilePath = await join(filesDir, memoryFileName);

          await writeTextFile(memoryFilePath, summary);
          onLog?.('success', `[Memory] Saved summary for ${file.relativePath}`);

          manifest.entries[file.relativePath] = {
            path: file.relativePath,
            modified: file.modified,
            memoryFile: memoryFileName,
            summarizedAt: Date.now(),
          };

          indexed++;
          indexedFiles.push(file.relativePath);
          remainingFiles.delete(file.relativePath);
        } catch (err) {
          console.error(`Error writing summary for ${file.relativePath}:`, err);
          onLog?.('error', `[Memory] Error writing summary for ${file.relativePath}`);
          errors++;
        }
      } else {
        errors++;
        const errorMessage = errorByFile.get(file.relativePath) || 'Summary not generated due to an unknown error.';
        try {
          const memoryFileName = slugifyPath(file.relativePath) + '.md';
          const memoryFilePath = await join(filesDir, memoryFileName);
          const stub = `# ${file.relativePath.split('/').pop()}
Path: \`${file.relativePath}\`
Type: ${file.extension.toUpperCase()}
Indexed: ${new Date().toISOString()}

---

Summary not generated. Error:
${errorMessage}
`;
          await writeTextFile(memoryFilePath, stub);
          onLog?.('warning', `[Memory] Wrote error stub for ${file.relativePath}`);
        } catch (err) {
          console.error(`Error writing error stub for ${file.relativePath}:`, err);
          onLog?.('error', `[Memory] Error writing error stub for ${file.relativePath}`);
        }
      }

      await saveProgress(memoryDir, {
        total: filesToSummarize.length,
        indexed,
        skipped: files.length - filesToProcess.length,
        errors,
        indexedFiles,
        remainingFiles: Array.from(remainingFiles),
        lastUpdated: Date.now(),
      });
    }
  }

  skipped = files.length - filesToProcess.length;

  // Generate index.md with directory overview
  onProgress?.({ phase: 'indexing', current: 0, total: 1 });

  try {
    const indexContent = await summarizeDirectory(
      config,
      workspaceDir,
      files,
      manifest.entries,
      signal,
      onLog
    );
    const indexPath = await join(memoryDir, INDEX_FILE);
    await writeTextFile(indexPath, indexContent);
  } catch (err) {
    console.error('Error generating index:', err);
    const msg = err instanceof Error ? err.message : String(err);
    onLog?.('error', `[Memory] Error generating index: ${msg}`);
    errors++;
  }

  // Update manifest
  manifest.lastSync = Date.now();
  await saveManifest(memoryDir, manifest);

  onProgress?.({ phase: 'complete', current: indexed, total: files.length });

  await saveProgress(memoryDir, {
    total: filesToSummarize.length,
    indexed,
    skipped,
    errors,
    indexedFiles,
    remainingFiles: Array.from(remainingFiles),
    lastUpdated: Date.now(),
  });

  return { indexed, skipped, errors };
}

/**
 * Load memory context for system prompt injection
 */
export async function loadMemoryContext(workspaceDir: string): Promise<string> {
  const memoryDir = await getMemoryDir(workspaceDir);

  if (!(await exists(memoryDir))) {
    return '';
  }

  const parts: string[] = [];

  // Load index.md
  const indexPath = await join(memoryDir, INDEX_FILE);
  if (await exists(indexPath)) {
    try {
      const indexContent = await readTextFile(indexPath);
      parts.push('## Workspace Memory\n\n' + indexContent);
    } catch {
      // Skip if can't read
    }
  }

  // Load recent journal entries (last 7 days)
  const journalDir = await join(memoryDir, JOURNAL_DIR);
  if (await exists(journalDir)) {
    try {
      const entries = await readDir(journalDir);
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      const recentEntries = entries
        .filter((e) => e.name.endsWith('.md'))
        .map((e) => {
          const dateStr = e.name.replace('.md', '');
          const date = new Date(dateStr);
          return { name: e.name, date: date.getTime() };
        })
        .filter((e) => e.date >= sevenDaysAgo)
        .sort((a, b) => b.date - a.date)
        .slice(0, 7);

      if (recentEntries.length > 0) {
        parts.push('\n## Recent Journal Entries\n');

        for (const entry of recentEntries) {
          const entryPath = await join(journalDir, entry.name);
          try {
            const content = await readTextFile(entryPath);
            parts.push(`\n### ${entry.name.replace('.md', '')}\n${content}`);
          } catch {
            // Skip if can't read
          }
        }
      }
    } catch {
      // Skip if can't read journal
    }
  }

  return parts.join('\n');
}

/**
 * Write a journal entry with today's date
 */
export async function writeJournalEntry(
  workspaceDir: string,
  content: string
): Promise<string> {
  const memoryDir = await ensureMemoryDir(workspaceDir);
  const journalDir = await join(memoryDir, JOURNAL_DIR);

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const journalPath = await join(journalDir, `${today}.md`);

  let existingContent = '';
  if (await exists(journalPath)) {
    existingContent = await readTextFile(journalPath);
  }

  const timestamp = new Date().toISOString().split('T')[1].slice(0, 5); // HH:MM
  const newEntry = `\n## ${timestamp}\n\n${content}\n`;

  await writeTextFile(journalPath, existingContent + newEntry);

  return journalPath;
}

/**
 * Read a specific memory file
 */
export async function readMemoryFile(
  workspaceDir: string,
  memoryPath: string
): Promise<string | null> {
  const memoryDir = await getMemoryDir(workspaceDir);
  const fullPath = await join(memoryDir, memoryPath);

  if (!(await exists(fullPath))) {
    return null;
  }

  try {
    return await readTextFile(fullPath);
  } catch {
    return null;
  }
}

/**
 * Search across all memory files
 */
export async function searchMemory(
  workspaceDir: string,
  query: string
): Promise<Array<{ file: string; matches: string[] }>> {
  const memoryDir = await getMemoryDir(workspaceDir);

  if (!(await exists(memoryDir))) {
    return [];
  }

  const results: Array<{ file: string; matches: string[] }> = [];
  const queryLower = query.toLowerCase();

  async function searchDir(dir: string): Promise<void> {
    try {
      const entries = await readDir(dir);

      for (const entry of entries) {
        const fullPath = await join(dir, entry.name);

        if (entry.isDirectory) {
          await searchDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          try {
            const content = await readTextFile(fullPath);
            const lines = content.split('\n');
            const matches: string[] = [];

            for (const line of lines) {
              if (line.toLowerCase().includes(queryLower)) {
                matches.push(line.trim());
              }
            }

            if (matches.length > 0) {
              const relativePath = fullPath.slice(memoryDir.length + 1);
              results.push({ file: relativePath, matches: matches.slice(0, 5) });
            }
          } catch {
            // Skip files we can't read
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await searchDir(memoryDir);
  return results;
}

/**
 * List all memory files
 */
export async function listMemoryFiles(
  workspaceDir: string
): Promise<string[]> {
  const memoryDir = await getMemoryDir(workspaceDir);
  const filesDir = await join(memoryDir, FILES_DIR);

  if (!(await exists(filesDir))) {
    return [];
  }

  try {
    const entries = await readDir(filesDir);
    return entries
      .filter((e) => e.name.endsWith('.md'))
      .map((e) => `${FILES_DIR}/${e.name}`);
  } catch {
    return [];
  }
}

/**
 * Check if memory is initialized for a workspace
 */
export async function isMemoryInitialized(workspaceDir: string): Promise<boolean> {
  const memoryDir = await getMemoryDir(workspaceDir);
  const indexPath = await join(memoryDir, INDEX_FILE);
  return exists(indexPath);
}

/**
 * Get sync status
 */
export async function getSyncStatus(workspaceDir: string): Promise<{
  initialized: boolean;
  lastSync: number;
  fileCount: number;
}> {
  const memoryDir = await getMemoryDir(workspaceDir);

  if (!(await exists(memoryDir))) {
    return { initialized: false, lastSync: 0, fileCount: 0 };
  }

  const manifest = await loadManifest(memoryDir);

  return {
    initialized: true,
    lastSync: manifest.lastSync,
    fileCount: Object.keys(manifest.entries).length,
  };
}
