/**
 * File operation tools for Neo coding assistant
 * Uses Tauri fs APIs for file system operations
 * Ported from erpai-cli vendor tools with enhanced edit matching
 */
import { z } from 'zod';
import { defineTool, type ToolAttachment } from '../tool';
import {
  readTextFile,
  readFile,
  writeTextFile,
  readDir,
  exists,
  mkdir,
  stat,
} from '@tauri-apps/plugin-fs';
import { join, basename, dirname } from '@tauri-apps/api/path';

const MAX_READ_LINES = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024;
const DEFAULT_LIMIT = 200;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatFileOutput(content: string, offset: number, limit: number): { output: string; preview: string; truncated: boolean } {
  const lines = content.split('\n');
  const raw: string[] = [];
  let bytes = 0;
  let truncatedByBytes = false;

  for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
    const line = lines[i].length > MAX_LINE_LENGTH
      ? lines[i].substring(0, MAX_LINE_LENGTH) + '...'
      : lines[i];
    const size = new TextEncoder().encode(line).length + (raw.length > 0 ? 1 : 0);
    if (bytes + size > MAX_BYTES) {
      truncatedByBytes = true;
      break;
    }
    raw.push(line);
    bytes += size;
  }

  const numbered = raw.map((line, index) => {
    return `${(index + offset + 1).toString().padStart(5, '0')}| ${line}`;
  });

  const preview = raw.slice(0, 20).join('\n');

  let output = '<file>\n';
  output += numbered.join('\n');

  const totalLines = lines.length;
  const lastReadLine = offset + raw.length;
  const hasMoreLines = totalLines > lastReadLine;
  const truncated = hasMoreLines || truncatedByBytes;

  if (truncatedByBytes) {
    output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`;
  } else if (hasMoreLines) {
    output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`;
  }
  output += '\n</file>';

  return { output, preview, truncated };
}

function matchGlob(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{GLOBSTAR}}/g, '.*');

  const regex = new RegExp(`(^|/)${regexStr}$`);
  return regex.test(str);
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const PDF_EXTENSION = 'pdf';
const PDF_MIME = 'application/pdf';

const MAX_ASSET_BYTES = 20 * 1024 * 1024; // 20MB

const BINARY_EXTENSIONS = new Set([
  'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'class', 'jar', 'war',
  '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'bin', 'dat',
  'obj', 'o', 'a', 'lib', 'wasm', 'pyc', 'pyo',
  'ico', 'mp3', 'mp4', 'avi', 'mov', 'wav', 'ogg',
]);

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'css', 'scss',
  'less', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'rs', 'py',
  'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh',
  'bash', 'zsh', 'fish', 'lua', 'swift', 'kt', 'kts', 'scala',
  'r', 'R', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'astro',
  'prisma', 'env', 'cfg', 'conf', 'ini', 'editorconfig', 'gitignore',
  'dockerignore', 'lock', 'log', 'csv', 'tsv', 'svg', 'makefile',
  'cmake', 'gradle', 'tf', 'hcl', 'zig', 'nim', 'dart', 'elm',
]);

function getFileExtension(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

function getImageMime(name: string): string | null {
  const ext = getFileExtension(name);
  return IMAGE_EXTENSIONS[ext] || null;
}

function isPdf(name: string): boolean {
  return getFileExtension(name) === PDF_EXTENSION;
}

function isBinaryExtension(name: string): boolean {
  const ext = getFileExtension(name);
  if (!ext) return false;
  return BINARY_EXTENSIONS.has(ext);
}

/** Convert Uint8Array to base64 string */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function isTextExtension(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return true; // no extension? assume text
  return TEXT_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Fuzzy edit / replace strategies (ported from erpai-cli)
// ---------------------------------------------------------------------------

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

function levenshtein(a: string, b: string): number {
  if (a === '' || b === '') return Math.max(a.length, b.length);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function mapIndexFromNormalized(original: string, normalized: string, normalizedIndex: number): number {
  let originalIndex = 0;
  let normalizedIndexCount = 0;

  while (originalIndex < original.length && normalizedIndexCount < normalizedIndex) {
    const originalChar = original[originalIndex];

    if (/\s/.test(originalChar)) {
      while (originalIndex < original.length && /\s/.test(original[originalIndex])) {
        originalIndex++;
      }
      normalizedIndexCount++;
    } else if (originalChar === normalized[normalizedIndexCount]) {
      originalIndex++;
      normalizedIndexCount++;
    } else {
      originalIndex++;
    }
  }

  return originalIndex;
}

/** Exact string match */
const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

/** Match ignoring leading/trailing whitespace per line */
const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) matchStartIndex += originalLines[k].length + 1;
      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length;
        if (k < searchLines.length - 1) matchEndIndex += 1;
      }
      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

/** Match by first/last line anchors with size similarity */
const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines.length < 3) return;
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) continue;
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }

  if (candidates.length === 0) return;

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    const actualBlockSize = endLine - startLine + 1;
    const similarity = actualBlockSize === searchBlockSize
      ? 1
      : 1 - Math.abs(actualBlockSize - searchBlockSize) / Math.max(actualBlockSize, searchBlockSize);
    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      yield originalLines.slice(startLine, endLine + 1).join('\n');
    }
    return;
  }

  const scored = candidates
    .map((candidate) => {
      const { startLine, endLine } = candidate;
      const actualBlock = originalLines.slice(startLine, endLine + 1).join('\n');
      const actualLines = actualBlock.split('\n');
      const contentSimilarity = 1 - levenshtein(actualBlock, find) / Math.max(actualBlock.length, find.length);
      const sizeSimilarity = 1 - Math.abs(actualLines.length - searchBlockSize) / Math.max(actualLines.length, searchBlockSize);
      const similarity = (contentSimilarity + sizeSimilarity) / 2;
      return { candidate, similarity, actualBlock };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const best = scored[0];
  if (best.similarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD) {
    yield best.actualBlock;
  }
};

/** Match after normalizing all whitespace */
const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalized = normalizeWhitespace(content);
  const normalizedFind = normalizeWhitespace(find);
  const index = normalized.indexOf(normalizedFind);
  if (index === -1) return;
  const originalIndex = mapIndexFromNormalized(content, normalized, index);
  const originalEndIndex = mapIndexFromNormalized(content, normalized, index + normalizedFind.length);
  yield content.substring(originalIndex, originalEndIndex);
};

/** Match ignoring indentation */
const NoIndentReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n').map((line) => line.trim());
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      yield originalLines.slice(i, i + searchLines.length).join('\n');
    }
  }
};

/** Match after normalizing blank lines */
const EmptyLineReplacer: Replacer = function* (content, find) {
  const normalizedContent = content.replace(/\n\s*\n/g, '\n\n');
  const normalizedFind = find.replace(/\n\s*\n/g, '\n\n');
  const index = normalizedContent.indexOf(normalizedFind);
  if (index === -1) return;
  const originalIndex = mapIndexFromNormalized(content, normalizedContent, index);
  const originalEndIndex = mapIndexFromNormalized(content, normalizedContent, index + normalizedFind.length);
  yield content.substring(originalIndex, originalEndIndex);
};

const replacers: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  NoIndentReplacer,
  EmptyLineReplacer,
];

/**
 * Smart replace using multiple strategies (ported from erpai-cli).
 * Tries exact match first, then progressively fuzzier strategies.
 */
export function smartReplace(content: string, find: string, replaceWith: string, replaceAll?: boolean): string {
  let matchCount = 0;
  let replacement: string | undefined;

  for (const replacer of replacers) {
    for (const match of replacer(content, find)) {
      matchCount++;
      replacement = match;
      if (replaceAll) continue;
      if (matchCount > 1) {
        throw new Error(
          'oldString found multiple times and requires more code context to uniquely identify the intended match',
        );
      }
    }
    if (matchCount > 0) break;
  }

  if (matchCount === 0 || !replacement) {
    throw new Error('oldString not found in file content');
  }

  if (replaceAll) {
    return content.split(replacement).join(replaceWith);
  }

  return content.replace(replacement, replaceWith);
}

// ---------------------------------------------------------------------------
// Read tool
// ---------------------------------------------------------------------------

export const ReadFileTool = defineTool('read', {
  description: `Read the contents of a file from the workspace.

Usage notes:
- The file path can be relative to the workspace or absolute
- You can specify offset and limit to read specific portions of large files
- Line numbers are included in the output for easy reference
- Supports reading images (PNG, JPG, GIF, WebP) and PDFs — they are passed to the model as attachments
- True binary files (archives, executables) cannot be read`,
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
      // Try to suggest similar files
      const dir = await dirname(filepath);
      const name = await basename(filepath);
      try {
        const entries = await readDir(dir);
        const suggestions = entries
          .filter(e => e.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(e.name.toLowerCase()))
          .map(e => e.name)
          .slice(0, 3);
        if (suggestions.length > 0) {
          throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`);
        }
      } catch {
        // dir doesn't exist either
      }
      throw new Error(`File not found: ${filepath}`);
    }

    const fileName = await basename(filepath);

    // ── Handle images ─────────────────────────────────────────────────
    const imageMime = getImageMime(filepath);
    if (imageMime) {
      const fileStat = await stat(filepath);
      if (fileStat.size > MAX_ASSET_BYTES) {
        throw new Error(`Image file too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB, max 20MB): ${filepath}`);
      }
      const bytes = await readFile(filepath);
      const base64 = uint8ToBase64(bytes);
      const attachment: ToolAttachment = {
        mime: imageMime,
        name: fileName,
        data: base64,
      };
      return {
        title: fileName,
        output: `Image read successfully: ${fileName} (${imageMime}, ${(fileStat.size / 1024).toFixed(1)}KB)`,
        metadata: { type: 'image', mime: imageMime, size: fileStat.size },
        attachments: [attachment],
      };
    }

    // ── Handle PDFs ───────────────────────────────────────────────────
    if (isPdf(filepath)) {
      const fileStat = await stat(filepath);
      if (fileStat.size > MAX_ASSET_BYTES) {
        throw new Error(`PDF file too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB, max 20MB): ${filepath}`);
      }
      const bytes = await readFile(filepath);
      const base64 = uint8ToBase64(bytes);
      const attachment: ToolAttachment = {
        mime: PDF_MIME,
        name: fileName,
        data: base64,
      };
      return {
        title: fileName,
        output: `PDF read successfully: ${fileName} (${(fileStat.size / 1024).toFixed(1)}KB). The content has been passed to the model for analysis.`,
        metadata: { type: 'pdf', size: fileStat.size },
        attachments: [attachment],
      };
    }

    // ── Handle binary files (rejected) ────────────────────────────────
    if (isBinaryExtension(filepath)) {
      throw new Error(`Cannot read binary file: ${filepath}`);
    }

    // ── Handle text files ─────────────────────────────────────────────
    const content = await readTextFile(filepath);
    const offset = params.offset ?? 0;
    const limit = params.limit ?? MAX_READ_LINES;

    const { output, truncated } = formatFileOutput(content, offset, limit);

    return {
      title: fileName,
      output,
      metadata: { truncated },
    };
  },
});

// ---------------------------------------------------------------------------
// Read file alias (Gemini-compatible: uses file_path snake_case)
// ---------------------------------------------------------------------------

export const ReadFileAliasTool = defineTool('read_file', {
  description: `Read a file from the workspace. Alias for read (Gemini-compatible parameter names).

Supports text files, images (PNG, JPG, GIF, WebP), and PDFs.`,
  parameters: z.object({
    file_path: z.string().describe('The path to the file to read'),
    offset: z.coerce.number().optional().describe('The line number to start reading from (0-based)'),
    limit: z.coerce.number().optional().describe('The number of lines to read'),
  }),
  async execute(params, ctx) {
    // Delegate to the main read tool's logic
    return ReadFileTool.execute(
      { filePath: params.file_path, offset: params.offset, limit: params.limit },
      ctx
    );
  },
});

// ---------------------------------------------------------------------------
// Read many files tool
// ---------------------------------------------------------------------------

export const ReadManyFilesTool = defineTool('read_many_files', {
  description: `Read multiple text files at once. More efficient than reading files one at a time.

Usage notes:
- Provide an array of file paths (relative or absolute)
- Images (PNG, JPG, GIF, WebP) and PDFs are SKIPPED — use the read tool for those
- Binary files are automatically skipped
- Each file's content is returned with line numbers
- Large files are truncated per-file

IMPORTANT: This tool only reads text files. To read images or PDFs, use the read tool instead.`,
  parameters: z.object({
    paths: z.array(z.string()).describe('Array of file paths to read'),
    limit: z.coerce.number().optional().describe('Max lines per file (defaults to 2000)'),
  }),
  async execute(params, ctx) {
    const limit = params.limit ?? MAX_READ_LINES;
    const outputParts: string[] = [];
    let successCount = 0;
    let errorCount = 0;
    const skippedFiles: Array<{ file: string; reason: string }> = [];

    for (const filePath of params.paths.slice(0, 50)) {
      let filepath = filePath;
      if (!filepath.startsWith('/')) {
        filepath = await join(ctx.workspaceDir, filepath);
      }

      try {
        const fileExists = await exists(filepath);
        if (!fileExists) {
          skippedFiles.push({ file: filePath, reason: 'File not found' });
          errorCount++;
          continue;
        }

        // Skip images — use read tool for these
        if (getImageMime(filepath)) {
          skippedFiles.push({ file: filePath, reason: 'Image file — use read tool instead' });
          continue;
        }

        // Skip PDFs — use read tool for these
        if (isPdf(filepath)) {
          skippedFiles.push({ file: filePath, reason: 'PDF file — use read tool instead' });
          continue;
        }

        // Skip binary files
        if (isBinaryExtension(filepath)) {
          skippedFiles.push({ file: filePath, reason: 'Binary file' });
          continue;
        }

        const content = await readTextFile(filepath);
        const { output } = formatFileOutput(content, 0, limit);
        outputParts.push(`\n--- ${filePath} ---\n${output}`);
        successCount++;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        skippedFiles.push({ file: filePath, reason: error });
        errorCount++;
      }
    }

    // Build summary
    const summaryLines: string[] = [];
    const truncatedFiles = params.paths.length > 50;
    summaryLines.push(`Read ${successCount} file(s).`);
    if (skippedFiles.length > 0) {
      summaryLines.push(`Skipped ${skippedFiles.length} file(s).`);
    }
    if (truncatedFiles) {
      summaryLines.push(`Limited to first 50 of ${params.paths.length} files.`);
    }

    if (skippedFiles.length > 0) {
      summaryLines.push('');
      summaryLines.push('Skipped files:');
      for (const skipped of skippedFiles.slice(0, 10)) {
        summaryLines.push(`- ${skipped.file} (${skipped.reason})`);
      }
      if (skippedFiles.length > 10) {
        summaryLines.push(`- ...and ${skippedFiles.length - 10} more`);
      }
    }

    const output = [summaryLines.join('\n'), ...outputParts].join('\n').trim();

    return {
      title: `Read ${successCount}, skipped ${skippedFiles.length}`,
      output,
      metadata: { successCount, errorCount, skipped: skippedFiles.length, truncated: truncatedFiles },
    };
  },
});

// ---------------------------------------------------------------------------
// Write tool
// ---------------------------------------------------------------------------

export const WriteFileTool = defineTool('write', {
  description: `Write content to a file in the workspace.

Usage notes:
- Creates the file if it doesn't exist
- Creates parent directories if they don't exist
- Overwrites existing file content completely`,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to write (relative or absolute)'),
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
      output: `Wrote file successfully. (${lines} lines)`,
      metadata: { lines },
    };
  },
});

// ---------------------------------------------------------------------------
// Edit tool (with fuzzy matching from erpai-cli)
// ---------------------------------------------------------------------------

export const EditFileTool = defineTool('edit', {
  description: `Edit a file by replacing specific text. Uses smart matching that can handle minor whitespace differences.

Usage notes:
- The oldString should match the text you want to replace
- Smart matching tries exact match first, then fuzzy strategies (trimmed lines, block anchors, normalized whitespace)
- If oldString matches multiple locations, provide more context to disambiguate
- Set replaceAll to true to replace all occurrences
- For creating new files, use the write tool instead`,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to edit'),
    oldString: z.string().describe('The text to find and replace'),
    newString: z.string().describe('The text to replace it with (must be different from oldString)'),
    replaceAll: z.coerce.boolean().optional().describe('Replace all occurrences of oldString (default false)'),
  }),
  async execute(params, ctx) {
    if (params.oldString === params.newString) {
      throw new Error('oldString and newString must be different');
    }

    let filepath = params.filePath;
    if (!filepath.startsWith('/')) {
      filepath = await join(ctx.workspaceDir, filepath);
    }

    const fileExists = await exists(filepath);
    if (!fileExists) {
      // If oldString is empty, treat as new file creation
      if (params.oldString === '') {
        const dir = await dirname(filepath);
        const dirExists = await exists(dir);
        if (!dirExists) await mkdir(dir, { recursive: true });
        await writeTextFile(filepath, params.newString);
        return {
          title: await basename(filepath),
          output: `Created new file: ${filepath}`,
          metadata: {},
        };
      }
      throw new Error(`File not found: ${filepath}`);
    }

    const content = await readTextFile(filepath);

    // Handle empty oldString as write-all
    if (params.oldString === '') {
      await writeTextFile(filepath, params.newString);
      return {
        title: await basename(filepath),
        output: `Replaced entire file content: ${filepath}`,
        metadata: {},
      };
    }

    const newContent = smartReplace(content, params.oldString, params.newString, params.replaceAll);
    await writeTextFile(filepath, newContent);

    return {
      title: await basename(filepath),
      output: 'Edit applied successfully.',
      metadata: {},
    };
  },
});

// ---------------------------------------------------------------------------
// MultiEdit tool
// ---------------------------------------------------------------------------

export const MultiEditTool = defineTool('multiedit', {
  description: `Apply multiple edits to a single file sequentially. More efficient than calling edit multiple times.

Usage notes:
- All edits are applied to the same file in order
- Each edit uses the same smart matching as the edit tool
- If any edit fails, the file is left in its partially-edited state
- Useful for refactoring / renaming across a file`,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to modify'),
    edits: z.array(z.object({
      oldString: z.string().describe('The text to replace'),
      newString: z.string().describe('The text to replace it with'),
      replaceAll: z.coerce.boolean().optional().describe('Replace all occurrences (default false)'),
    })).describe('Array of edit operations to perform sequentially'),
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

    let content = await readTextFile(filepath);
    let appliedCount = 0;

    for (const edit of params.edits) {
      if (edit.oldString === edit.newString) continue;
      content = smartReplace(content, edit.oldString, edit.newString, edit.replaceAll);
      appliedCount++;
    }

    await writeTextFile(filepath, content);

    return {
      title: await basename(filepath),
      output: `Applied ${appliedCount} edit(s) successfully.`,
      metadata: { appliedCount, totalEdits: params.edits.length },
    };
  },
});

// ---------------------------------------------------------------------------
// Replace tool (Gemini-compatible alias for edit)
// ---------------------------------------------------------------------------

export const ReplaceTool = defineTool('replace', {
  description: `Find and replace text in a file. Gemini-compatible alias for the edit tool.

Usage notes:
- Same smart matching as edit (exact, line-trimmed, block anchor, whitespace-normalized)
- Use file_path, old_string, new_string parameter names`,
  parameters: z.object({
    file_path: z.string().describe('The path to the file to modify'),
    old_string: z.string().describe('The text to replace'),
    new_string: z.string().describe('The text to replace it with'),
    expected_replacements: z.coerce.number().optional().describe('Expected number of replacements'),
  }),
  async execute(params, ctx) {
    if (params.expected_replacements !== undefined && params.expected_replacements < 1) {
      throw new Error('expected_replacements must be >= 1');
    }

    let filepath = params.file_path;
    if (!filepath.startsWith('/')) {
      filepath = await join(ctx.workspaceDir, filepath);
    }

    const fileExists = await exists(filepath);
    if (!fileExists) {
      throw new Error(`File not found: ${filepath}`);
    }

    const content = await readTextFile(filepath);
    const replaceAll = params.expected_replacements ? params.expected_replacements > 1 : false;
    const newContent = smartReplace(content, params.old_string, params.new_string, replaceAll);
    await writeTextFile(filepath, newContent);

    return {
      title: await basename(filepath),
      output: 'Edit applied successfully.',
      metadata: {},
    };
  },
});

// ---------------------------------------------------------------------------
// List directory tool (enhanced)
// ---------------------------------------------------------------------------

export const ListDirectoryTool = defineTool('ls', {
  description: `List files and directories in a given path.

Usage notes:
- Returns file names sorted with directories first
- By default hides dotfiles; set includeHidden to true to show them
- Limited to 200 entries by default`,
  parameters: z.object({
    path: z.string().describe('The directory path to list').optional(),
    limit: z.coerce.number().optional().describe(`Max entries to return (default: ${DEFAULT_LIMIT})`),
    includeHidden: z.coerce.boolean().optional().describe('Include dotfiles and dotfolders (default: false)'),
  }),
  async execute(params, ctx) {
    let dirpath = params.path || ctx.workspaceDir;
    if (!dirpath.startsWith('/')) {
      dirpath = await join(ctx.workspaceDir, dirpath);
    }

    const dirExists = await exists(dirpath);
    if (!dirExists) {
      throw new Error(`Directory not found: ${dirpath}`);
    }

    const includeHidden = params.includeHidden ?? false;
    const limit = params.limit ?? DEFAULT_LIMIT;

    const entries = await readDir(dirpath);
    const filtered = entries.filter(entry => includeHidden || !entry.name.startsWith('.'));

    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of filtered) {
      if (entry.isDirectory) {
        dirs.push(entry.name + '/');
      } else {
        files.push(entry.name);
      }
    }

    const sorted = [...dirs.sort(), ...files.sort()];
    const sliced = sorted.slice(0, limit);
    const output = sliced.join('\n') || '(empty directory)';

    return {
      title: dirpath,
      output,
      metadata: { count: sliced.length, total: sorted.length },
    };
  },
});

// ---------------------------------------------------------------------------
// Glob tool
// ---------------------------------------------------------------------------

export const GlobTool = defineTool('glob', {
  description: `Find files matching a glob pattern in the workspace.

Usage notes:
- Searches recursively from the workspace root or specified directory
- Returns matching file paths (up to 100 results)
- Patterns like "*.ts", "src/**/*.tsx" are supported`,
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

    async function search(dir: string, depth: number = 0) {
      if (depth > 10) return;

      try {
        const entries = await readDir(dir);
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;

          const fullPath = await join(dir, entry.name);

          if (entry.isDirectory) {
            await search(fullPath, depth + 1);
          } else {
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
        output: 'No files found',
        metadata: { count: 0 },
      };
    }

    const truncated = matches.length > 100;
    const relativePaths = await Promise.all(
      matches.slice(0, 100).map(async (p) => {
        if (p.startsWith(ctx.workspaceDir)) {
          return p.slice(ctx.workspaceDir.length + 1);
        }
        return p;
      })
    );

    const output = relativePaths.join('\n');
    if (truncated) {
      return {
        title: `glob: ${pattern}`,
        output: output + '\n\n(Results truncated. Consider a more specific path or pattern.)',
        metadata: { count: matches.length, truncated: true },
      };
    }

    return {
      title: `glob: ${pattern}`,
      output,
      metadata: { count: matches.length, truncated: false },
    };
  },
});

// ---------------------------------------------------------------------------
// Grep tool
// ---------------------------------------------------------------------------

export const GrepTool = defineTool('grep', {
  description: `Search for a pattern in files within the workspace.

Usage notes:
- Searches file contents for the given regex pattern
- Returns matching lines grouped by file with line numbers
- Results sorted by file, limited to 100 matches`,
  parameters: z.object({
    pattern: z.string().describe('The regex pattern to search for in file contents'),
    path: z.string().optional().describe('The directory to search in (defaults to workspace root)'),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.ts", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error('pattern is required');
    }

    let searchPath = params.path || ctx.workspaceDir;
    if (!searchPath.startsWith('/')) {
      searchPath = await join(ctx.workspaceDir, searchPath);
    }

    const regex = new RegExp(params.pattern, 'gi');
    const filePattern = params.include;

    type GrepMatch = { path: string; lineNum: number; lineText: string };
    const matches: GrepMatch[] = [];

    async function search(dir: string, depth: number = 0) {
      if (depth > 10 || matches.length >= 100) return;

      try {
        const entries = await readDir(dir);
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (matches.length >= 100) break;

          const fullPath = await join(dir, entry.name);

          if (entry.isDirectory) {
            await search(fullPath, depth + 1);
          } else {
            if (filePattern && !matchGlob(entry.name, filePattern)) continue;
            if (isBinaryExtension(entry.name)) continue;
            if (!isTextExtension(entry.name)) continue;

            try {
              const content = await readTextFile(fullPath);
              const lines = content.split('\n');

              for (let i = 0; i < lines.length && matches.length < 100; i++) {
                if (regex.test(lines[i])) {
                  const relativePath = fullPath.startsWith(ctx.workspaceDir)
                    ? fullPath.slice(ctx.workspaceDir.length + 1)
                    : fullPath;
                  const lineText = lines[i].length > MAX_LINE_LENGTH
                    ? lines[i].substring(0, MAX_LINE_LENGTH) + '...'
                    : lines[i];
                  matches.push({ path: relativePath, lineNum: i + 1, lineText: lineText.trim() });
                }
                regex.lastIndex = 0;
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

    if (matches.length === 0) {
      return {
        title: params.pattern,
        output: 'No files found',
        metadata: { matches: 0, truncated: false },
      };
    }

    // Group by file
    const outputLines = [`Found ${matches.length} matches`];
    let currentFile = '';
    for (const match of matches) {
      if (currentFile !== match.path) {
        if (currentFile !== '') outputLines.push('');
        currentFile = match.path;
        outputLines.push(`${match.path}:`);
      }
      outputLines.push(`  Line ${match.lineNum}: ${match.lineText}`);
    }

    const truncated = matches.length >= 100;
    if (truncated) {
      outputLines.push('');
      outputLines.push('(Results truncated. Consider a more specific path or pattern.)');
    }

    return {
      title: params.pattern,
      output: outputLines.join('\n'),
      metadata: { matches: matches.length, truncated },
    };
  },
});
