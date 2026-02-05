/**
 * File operation tools for Neo coding assistant
 * Uses Tauri fs APIs for file system operations
 */
import { z } from 'zod';
import { defineTool } from '../tool';
import {
  readTextFile,
  writeTextFile,
  readDir,
  exists,
  mkdir,
} from '@tauri-apps/plugin-fs';
import { join, basename, dirname } from '@tauri-apps/api/path';

const MAX_READ_LINES = 2000;
const MAX_LINE_LENGTH = 2000;

function formatFileOutput(content: string, offset: number, limit: number): { output: string; truncated: boolean } {
  const lines = content.split('\n');
  const raw: string[] = [];

  for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
    const line = lines[i].length > MAX_LINE_LENGTH 
      ? lines[i].substring(0, MAX_LINE_LENGTH) + '...' 
      : lines[i];
    raw.push(line);
  }

  const numbered = raw.map((line, index) => {
    return `${(index + offset + 1).toString().padStart(5, '0')}| ${line}`;
  });

  let output = '<file>\n';
  output += numbered.join('\n');

  const totalLines = lines.length;
  const lastReadLine = offset + raw.length;
  const hasMoreLines = totalLines > lastReadLine;

  if (hasMoreLines) {
    output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`;
  }
  output += '\n</file>';

  return { output, truncated: hasMoreLines };
}

export const ReadFileTool = defineTool('read', {
  description: `Read the contents of a file from the workspace.

Usage notes:
- The file path can be relative to the workspace or absolute
- You can specify offset and limit to read specific portions of large files
- Line numbers are included in the output for easy reference`,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to read'),
    offset: z.coerce.number().optional().describe('The line number to start reading from (0-based)'),
    limit: z.coerce.number().optional().describe('The number of lines to read (defaults to 2000)'),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath;
    if (!filepath.startsWith('/')) {
      filepath = await join(ctx.workspaceDir, filepath);
    }

    const fileExists = await exists(filepath);
    if (!fileExists) {
      throw new Error(`File not found: ${filepath}`);
    }

    const content = await readTextFile(filepath);
    const offset = params.offset ?? 0;
    const limit = params.limit ?? MAX_READ_LINES;

    const { output, truncated } = formatFileOutput(content, offset, limit);

    return {
      title: await basename(filepath),
      output,
      metadata: { truncated },
    };
  },
});

export const WriteFileTool = defineTool('write', {
  description: `Write content to a file in the workspace.

Usage notes:
- Creates the file if it doesn't exist
- Creates parent directories if they don't exist
- Overwrites existing file content`,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to write'),
    content: z.string().describe('The content to write to the file'),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath;
    if (!filepath.startsWith('/')) {
      filepath = await join(ctx.workspaceDir, filepath);
    }

    // Ensure parent directory exists
    const dir = await dirname(filepath);
    const dirExists = await exists(dir);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }

    await writeTextFile(filepath, params.content);

    const lines = params.content.split('\n').length;
    return {
      title: await basename(filepath),
      output: `Successfully wrote ${lines} lines to ${filepath}`,
      metadata: { lines },
    };
  },
});

export const ListDirectoryTool = defineTool('ls', {
  description: `List files and directories in a given path.

Usage notes:
- Returns file names and whether they are directories
- Does not show hidden files (starting with .)`,
  parameters: z.object({
    path: z.string().describe('The directory path to list'),
  }),
  async execute(params, ctx) {
    let dirpath = params.path;
    if (!dirpath.startsWith('/')) {
      dirpath = await join(ctx.workspaceDir, dirpath);
    }

    const dirExists = await exists(dirpath);
    if (!dirExists) {
      throw new Error(`Directory not found: ${dirpath}`);
    }

    const entries = await readDir(dirpath);
    const files: string[] = [];
    const dirs: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory) {
        dirs.push(entry.name + '/');
      } else {
        files.push(entry.name);
      }
    }

    const sorted = [...dirs.sort(), ...files.sort()];
    const output = sorted.join('\n') || '(empty directory)';

    return {
      title: dirpath,
      output,
      metadata: { count: sorted.length },
    };
  },
});

export const GlobTool = defineTool('glob', {
  description: `Find files matching a glob pattern in the workspace.

Usage notes:
- Searches recursively from the workspace root or specified directory
- Returns matching file paths`,
  parameters: z.object({
    pattern: z.string().describe('The glob pattern to match (e.g., "*.ts", "src/**/*.tsx")'),
    path: z.string().optional().describe('The directory to search in (defaults to workspace root)'),
  }),
  async execute(params, ctx) {
    let searchPath = params.path || ctx.workspaceDir;
    if (!searchPath.startsWith('/')) {
      searchPath = await join(ctx.workspaceDir, searchPath);
    }

    const pattern = params.pattern;
    const matches: string[] = [];

    // Simple recursive search with basic glob matching
    async function search(dir: string, depth: number = 0) {
      if (depth > 10) return; // Prevent infinite recursion
      
      try {
        const entries = await readDir(dir);
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          
          const fullPath = await join(dir, entry.name);
          
          if (entry.isDirectory) {
            await search(fullPath, depth + 1);
          } else {
            // Simple pattern matching
            if (matchGlob(entry.name, pattern) || matchGlob(fullPath, pattern)) {
              matches.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    await search(searchPath);

    if (matches.length === 0) {
      return {
        title: `glob: ${pattern}`,
        output: 'No matches found',
        metadata: { count: 0 },
      };
    }

    // Make paths relative to workspace
    const relativePaths = await Promise.all(
      matches.slice(0, 100).map(async (p) => {
        if (p.startsWith(ctx.workspaceDir)) {
          return p.slice(ctx.workspaceDir.length + 1);
        }
        return p;
      })
    );

    return {
      title: `glob: ${pattern}`,
      output: relativePaths.join('\n'),
      metadata: { count: matches.length, truncated: matches.length > 100 },
    };
  },
});

function matchGlob(str: string, pattern: string): boolean {
  // Simple glob matching - convert glob to regex
  const regexStr = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{GLOBSTAR}}/g, '.*');
  
  const regex = new RegExp(`(^|/)${regexStr}$`);
  return regex.test(str);
}

export const GrepTool = defineTool('grep', {
  description: `Search for a pattern in files within the workspace.

Usage notes:
- Searches file contents for the given pattern
- Returns matching lines with file paths and line numbers`,
  parameters: z.object({
    pattern: z.string().describe('The search pattern (supports regex)'),
    path: z.string().optional().describe('The directory to search in (defaults to workspace root)'),
    filePattern: z.string().optional().describe('File pattern to filter (e.g., "*.ts")'),
  }),
  async execute(params, ctx) {
    let searchPath = params.path || ctx.workspaceDir;
    if (!searchPath.startsWith('/')) {
      searchPath = await join(ctx.workspaceDir, searchPath);
    }

    const regex = new RegExp(params.pattern, 'gi');
    const results: string[] = [];
    const filePattern = params.filePattern;

    async function search(dir: string, depth: number = 0) {
      if (depth > 10 || results.length >= 100) return;
      
      try {
        const entries = await readDir(dir);
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (results.length >= 100) break;
          
          const fullPath = await join(dir, entry.name);
          
          if (entry.isDirectory) {
            await search(fullPath, depth + 1);
          } else {
            // Check file pattern
            if (filePattern && !matchGlob(entry.name, filePattern)) continue;
            
            // Skip binary files
            const ext = entry.name.split('.').pop()?.toLowerCase();
            const textExts = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'css', 'html', 'yaml', 'yml', 'toml', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp'];
            if (ext && !textExts.includes(ext)) continue;
            
            try {
              const content = await readTextFile(fullPath);
              const lines = content.split('\n');
              
              for (let i = 0; i < lines.length && results.length < 100; i++) {
                if (regex.test(lines[i])) {
                  const relativePath = fullPath.startsWith(ctx.workspaceDir) 
                    ? fullPath.slice(ctx.workspaceDir.length + 1) 
                    : fullPath;
                  results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
                }
                regex.lastIndex = 0; // Reset regex state
              }
            } catch {
              // Ignore read errors
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    await search(searchPath);

    if (results.length === 0) {
      return {
        title: `grep: ${params.pattern}`,
        output: 'No matches found',
        metadata: { count: 0 },
      };
    }

    return {
      title: `grep: ${params.pattern}`,
      output: results.join('\n'),
      metadata: { count: results.length, truncated: results.length >= 100 },
    };
  },
});

export const EditFileTool = defineTool('edit', {
  description: `Edit a file by replacing specific text.

Usage notes:
- The old_string must match exactly (including whitespace and indentation)
- Use this for targeted edits to existing files
- For creating new files, use the write tool instead`,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to edit'),
    oldString: z.string().describe('The exact text to find and replace'),
    newString: z.string().describe('The text to replace it with'),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath;
    if (!filepath.startsWith('/')) {
      filepath = await join(ctx.workspaceDir, filepath);
    }

    const fileExists = await exists(filepath);
    if (!fileExists) {
      throw new Error(`File not found: ${filepath}`);
    }

    const content = await readTextFile(filepath);
    
    if (!content.includes(params.oldString)) {
      throw new Error(`Could not find the specified text to replace in ${filepath}`);
    }

    const newContent = content.replace(params.oldString, params.newString);
    await writeTextFile(filepath, newContent);

    return {
      title: await basename(filepath),
      output: `Successfully edited ${filepath}`,
      metadata: {},
    };
  },
});
