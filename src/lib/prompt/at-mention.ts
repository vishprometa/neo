/**
 * @ mention processor for Neo
 * Handles @path syntax for file and directory injection
 */

import { readTextFile, readDir, exists, stat } from '@tauri-apps/plugin-fs';
import { join, basename } from '@tauri-apps/api/path';

export interface AtMention {
  /** The path extracted */
  path: string;
  /** The starting index of the mention (inclusive) */
  startIndex: number;
  /** The ending index of the mention (exclusive) */
  endIndex: number;
  /** The original raw text including @ */
  raw: string;
}

export interface ProcessedPrompt {
  /** The processed prompt with file contents injected */
  text: string;
  /** List of files that were injected */
  injectedFiles: string[];
  /** Any errors encountered during processing */
  errors: string[];
}

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const MAX_DIRECTORY_FILES = 50;
const MAX_TOTAL_INJECTION_SIZE = 1024 * 1024; // 1MB total

/**
 * Extract @ mentions from a prompt string
 * Supports @path and @path/to/file syntax
 * Path ends at whitespace or end of string
 */
export function extractAtMentions(prompt: string): AtMention[] {
  const mentions: AtMention[] = [];
  
  // Match @followed by a path (no whitespace, continues until space or end)
  // Path can contain: letters, numbers, /, ., -, _, ~
  const regex = /@([a-zA-Z0-9_.~\-\/]+)/g;
  let match;

  while ((match = regex.exec(prompt)) !== null) {
    const path = match[1];
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    // Skip if it looks like an email address
    if (startIndex > 0 && /\w/.test(prompt[startIndex - 1])) {
      continue;
    }

    // Skip common non-file @ patterns
    if (['param', 'returns', 'type', 'example', 'see', 'link', 'author', 'version', 'since', 'deprecated'].includes(path)) {
      continue;
    }

    mentions.push({
      path,
      startIndex,
      endIndex,
      raw: match[0],
    });
  }

  return mentions;
}

/**
 * Read file content with size limits
 */
async function readFileContent(filepath: string): Promise<{ content: string; size: number } | null> {
  try {
    const fileExists = await exists(filepath);
    if (!fileExists) return null;

    const fileStat = await stat(filepath);
    if (fileStat.size > MAX_FILE_SIZE) {
      return { content: `(File too large: ${Math.round(fileStat.size / 1024)}KB > ${MAX_FILE_SIZE / 1024}KB limit)`, size: 0 };
    }

    const content = await readTextFile(filepath);
    return { content, size: content.length };
  } catch {
    return null;
  }
}

/**
 * Get text file extensions for filtering
 */
const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'css', 'scss', 'html',
  'yaml', 'yml', 'toml', 'xml', 'rs', 'py', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'vue',
  'svelte', 'astro', 'prisma', 'env', 'gitignore', 'dockerfile',
]);

function isTextFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  // Also allow files without extensions or specific names
  if (!ext || filename.startsWith('.')) return true;
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Read directory contents recursively
 */
async function readDirectoryContents(
  dirpath: string,
  workspaceDir: string,
  maxFiles: number = MAX_DIRECTORY_FILES
): Promise<{ files: Array<{ path: string; content: string }>; truncated: boolean }> {
  const files: Array<{ path: string; content: string }> = [];
  let truncated = false;

  async function scanDir(dir: string, depth: number = 0) {
    if (depth > 5 || files.length >= maxFiles) {
      truncated = files.length >= maxFiles;
      return;
    }

    try {
      const entries = await readDir(dir);
      const sortedEntries = entries.sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of sortedEntries) {
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }

        // Skip hidden files/directories
        if (entry.name.startsWith('.')) continue;
        // Skip node_modules, dist, build, etc.
        if (['node_modules', 'dist', 'build', '.git', 'coverage', '.next'].includes(entry.name)) {
          continue;
        }

        const fullPath = await join(dir, entry.name);

        if (entry.isDirectory) {
          await scanDir(fullPath, depth + 1);
        } else if (isTextFile(entry.name)) {
          const result = await readFileContent(fullPath);
          if (result) {
            const relativePath = fullPath.startsWith(workspaceDir)
              ? fullPath.slice(workspaceDir.length + 1)
              : fullPath;
            files.push({ path: relativePath, content: result.content });
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  await scanDir(dirpath);
  return { files, truncated };
}

/**
 * Process @ mentions in a prompt
 * Replaces @{path} with file/directory contents
 */
export async function processAtMentions(
  prompt: string,
  workspaceDir: string
): Promise<ProcessedPrompt> {
  const mentions = extractAtMentions(prompt);

  if (mentions.length === 0) {
    return { text: prompt, injectedFiles: [], errors: [] };
  }

  const injectedFiles: string[] = [];
  const errors: string[] = [];
  let totalInjectedSize = 0;

  // Process mentions in reverse order to preserve indices
  let processedText = prompt;
  const sortedMentions = [...mentions].sort((a, b) => b.startIndex - a.startIndex);

  for (const mention of sortedMentions) {
    let filepath = mention.path;

    // Handle relative paths
    if (!filepath.startsWith('/')) {
      filepath = await join(workspaceDir, filepath);
    }

    let replacement = '';

    try {
      const pathExists = await exists(filepath);
      if (!pathExists) {
        errors.push(`Path not found: ${mention.path}`);
        replacement = `[File not found: ${mention.path}]`;
      } else {
        const fileStat = await stat(filepath);

        if (fileStat.isDirectory) {
          // Directory: read contents
          const { files, truncated } = await readDirectoryContents(filepath, workspaceDir);

          if (files.length === 0) {
            replacement = `[Directory empty or no readable files: ${mention.path}]`;
          } else {
            const dirContent = files.map(f => {
              return `--- ${f.path} ---\n${f.content}`;
            }).join('\n\n');

            replacement = `--- Start of directory: ${mention.path} ---\n${dirContent}`;
            if (truncated) {
              replacement += `\n(Directory truncated: more files exist)`;
            }
            replacement += `\n--- End of directory: ${mention.path} ---`;

            injectedFiles.push(...files.map(f => f.path));
            totalInjectedSize += dirContent.length;
          }
        } else {
          // Single file
          const result = await readFileContent(filepath);
          if (result) {
            const filename = await basename(filepath);
            const relativePath = filepath.startsWith(workspaceDir)
              ? filepath.slice(workspaceDir.length + 1)
              : filepath;

            replacement = `--- ${relativePath} ---\n${result.content}\n--- End of ${filename} ---`;
            injectedFiles.push(relativePath);
            totalInjectedSize += result.size;
          } else {
            errors.push(`Failed to read file: ${mention.path}`);
            replacement = `[Failed to read: ${mention.path}]`;
          }
        }
      }

      // Check total size limit
      if (totalInjectedSize > MAX_TOTAL_INJECTION_SIZE) {
        errors.push('Total injected content exceeds size limit');
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Error processing ${mention.path}: ${msg}`);
      replacement = `[Error: ${mention.path}]`;
    }

    // Replace the mention with the content
    processedText = 
      processedText.slice(0, mention.startIndex) + 
      replacement + 
      processedText.slice(mention.endIndex);
  }

  return {
    text: processedText,
    injectedFiles,
    errors,
  };
}
