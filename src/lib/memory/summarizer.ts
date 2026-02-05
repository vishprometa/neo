/**
 * LLM-based file summarization for Neo memory system
 * Uses Gemini to generate semantic summaries of files
 * 
 * Optimized for rate limits:
 * - Batches multiple small files into single API calls
 * - Smart content truncation based on file type
 * - Exponential backoff on rate limit errors
 */
import { GoogleGenAI } from '@google/genai';
import type { FileInfo, ManifestEntry } from './service';

/** Maximum tokens per batch (conservative estimate: 4 chars = 1 token) */
const MAX_BATCH_CHARS = 12000;
/** Maximum files per batch */
const MAX_FILES_PER_BATCH = 8;
/** Base delay between batches (ms) */
const BASE_DELAY = 500;
/** Max retries on rate limit */
const MAX_RETRIES = 3;

interface FileToSummarize {
  relativePath: string;
  content: string;
  extension: string;
}

interface BatchResult {
  summaries: Map<string, string>;
  errors: string[];
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get smart truncation limit based on file type
 * Config/data files need less context than code files
 */
function getSmartTruncateLimit(extension: string): number {
  const limits: Record<string, number> = {
    // Config files - minimal context needed
    json: 1500,
    yaml: 1500,
    yml: 1500,
    toml: 1500,
    env: 500,
    gitignore: 500,
    // Data/text files
    md: 2000,
    txt: 1500,
    // Code files - more context helpful
    ts: 3000,
    tsx: 3000,
    js: 3000,
    jsx: 3000,
    py: 3000,
    go: 3000,
    rs: 3000,
    // Other
    sql: 2000,
    graphql: 2000,
    prisma: 2000,
    css: 1500,
    scss: 1500,
    html: 2000,
  };
  return limits[extension.toLowerCase()] || 2000;
}

/**
 * Summarize a single file using Gemini
 * This is the public API - internally uses batching when called via summarizeFilesBatch
 */
export async function summarizeFile(
  apiKey: string,
  relativePath: string,
  content: string,
  extension: string
): Promise<string> {
  const results = await summarizeFilesBatch(apiKey, [
    { relativePath, content, extension }
  ]);
  
  const summary = results.summaries.get(relativePath);
  if (!summary) {
    throw new Error(results.errors[0] || `Failed to summarize ${relativePath}`);
  }
  return summary;
}

/**
 * Summarize multiple files in optimized batches
 * Groups files to minimize API calls while staying under token limits
 */
export async function summarizeFilesBatch(
  apiKey: string,
  files: FileToSummarize[],
  onProgress?: (processed: number, total: number) => void
): Promise<BatchResult> {
  const client = new GoogleGenAI({ apiKey });
  const summaries = new Map<string, string>();
  const errors: string[] = [];
  
  // Prepare files with smart truncation
  const preparedFiles = files.map(f => ({
    ...f,
    truncatedContent: truncateContent(f.content, getSmartTruncateLimit(f.extension)),
    charCount: 0, // Will be set after truncation
  }));
  
  // Calculate char counts
  for (const f of preparedFiles) {
    f.charCount = f.relativePath.length + f.truncatedContent.length + 200; // 200 for prompt overhead
  }
  
  // Create batches
  const batches: typeof preparedFiles[] = [];
  let currentBatch: typeof preparedFiles = [];
  let currentBatchChars = 0;
  
  for (const file of preparedFiles) {
    // If single file exceeds limit, it goes in its own batch
    if (file.charCount > MAX_BATCH_CHARS) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchChars = 0;
      }
      batches.push([file]);
      continue;
    }
    
    // Check if adding this file would exceed limits
    if (
      currentBatch.length >= MAX_FILES_PER_BATCH ||
      currentBatchChars + file.charCount > MAX_BATCH_CHARS
    ) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [file];
      currentBatchChars = file.charCount;
    } else {
      currentBatch.push(file);
      currentBatchChars += file.charCount;
    }
  }
  
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  
  console.log(`[Memory] Summarizing ${files.length} files in ${batches.length} batches`);
  
  let processedFiles = 0;
  
  // Process batches with rate limiting
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let retries = 0;
    let delay = BASE_DELAY;
    
    while (retries <= MAX_RETRIES) {
      try {
        const batchSummaries = await processBatch(client, batch);
        
        for (const [path, summary] of batchSummaries) {
          summaries.set(path, summary);
        }
        
        processedFiles += batch.length;
        onProgress?.(processedFiles, files.length);
        
        // Delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await sleep(delay);
        }
        break;
        
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        
        // Check for rate limit error
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit')) {
          retries++;
          if (retries <= MAX_RETRIES) {
            delay = delay * 2; // Exponential backoff
            console.warn(`[Memory] Rate limited, retry ${retries}/${MAX_RETRIES} after ${delay}ms`);
            await sleep(delay);
            continue;
          }
        }
        
        // Non-retryable error or max retries exceeded
        console.error(`[Memory] Batch ${i + 1} failed:`, errMsg);
        for (const file of batch) {
          errors.push(`${file.relativePath}: ${errMsg}`);
        }
        processedFiles += batch.length;
        onProgress?.(processedFiles, files.length);
        break;
      }
    }
  }
  
  return { summaries, errors };
}

/**
 * Process a single batch of files
 */
async function processBatch(
  client: GoogleGenAI,
  files: Array<{ relativePath: string; truncatedContent: string; extension: string }>
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();
  
  // Single file - use simple prompt
  if (files.length === 1) {
    const file = files[0];
    const fileType = getFileType(file.extension);
    
    const prompt = `Analyze this ${fileType} file. Reply with a brief summary (max 150 words).

File: ${file.relativePath}

\`\`\`${file.extension}
${file.truncatedContent}
\`\`\`

Format:
**Summary**: 1-2 sentences
**Key Elements**: Main exports/functions/classes (if any)
**Purpose**: Why this file exists`;

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const header = formatHeader(file.relativePath, fileType);
    summaries.set(file.relativePath, header + (response.text || ''));
    return summaries;
  }
  
  // Multiple files - batch prompt
  const filesSection = files.map((f, idx) => {
    const fileType = getFileType(f.extension);
    return `--- FILE ${idx + 1}: ${f.relativePath} (${fileType}) ---
\`\`\`${f.extension}
${f.truncatedContent}
\`\`\``;
  }).join('\n\n');

  const prompt = `Analyze these ${files.length} files. For EACH file, provide a brief summary.

${filesSection}

For EACH file, respond with:
=== ${files.map(f => f.relativePath).join(' | ')} ===

FORMAT (repeat for each file):
### [filename]
**Summary**: 1-2 sentences
**Key Elements**: Main exports/functions (if any)
**Purpose**: Why it exists

Keep each summary under 100 words. Be concise.`;

  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const responseText = response.text || '';
  
  // Parse batched response - split by file headers
  for (const file of files) {
    const fileType = getFileType(file.extension);
    const fileName = file.relativePath.split('/').pop() || file.relativePath;
    
    // Try to find this file's section in the response
    const fileSection = extractFileSection(responseText, fileName, file.relativePath);
    const header = formatHeader(file.relativePath, fileType);
    
    summaries.set(file.relativePath, header + (fileSection || 'Summary not generated.'));
  }
  
  return summaries;
}

/**
 * Extract a specific file's section from batched response
 */
function extractFileSection(response: string, fileName: string, relativePath: string): string {
  // Try various patterns to find the file's section
  const patterns = [
    new RegExp(`###\\s*\\[?${escapeRegex(fileName)}\\]?([\\s\\S]*?)(?=###|$)`, 'i'),
    new RegExp(`###\\s*${escapeRegex(relativePath)}([\\s\\S]*?)(?=###|$)`, 'i'),
    new RegExp(`\\*\\*${escapeRegex(fileName)}\\*\\*([\\s\\S]*?)(?=\\*\\*[^*]+\\*\\*|###|$)`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // Fallback: if only one file or can't parse, return whole response
  return response;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatHeader(relativePath: string, fileType: string): string {
  return `# ${relativePath.split('/').pop()}
Path: \`${relativePath}\`
Type: ${fileType}
Indexed: ${new Date().toISOString()}

---

`;
}

/**
 * Generate a directory index summary
 */
export async function summarizeDirectory(
  apiKey: string,
  workspaceDir: string,
  files: FileInfo[],
  entries: Record<string, ManifestEntry>
): Promise<string> {
  const client = new GoogleGenAI({ apiKey });
  
  // Build directory tree
  const tree = buildDirectoryTree(files.map(f => f.relativePath));
  
  // Get file type distribution
  const typeDistribution = getTypeDistribution(files);
  
  // Read some key files for context (README, package.json, etc)
  const keyFiles = files.filter(f => 
    f.relativePath.toLowerCase().includes('readme') ||
    f.relativePath === 'package.json' ||
    f.relativePath === 'Cargo.toml' ||
    f.relativePath === 'pyproject.toml' ||
    f.relativePath === 'go.mod'
  ).slice(0, 3);

  const folderName = workspaceDir.split('/').pop() || 'workspace';

  const prompt = `Analyze this project structure and create a high-level overview.

Project: ${folderName}
Total files indexed: ${files.length}

Directory structure:
${tree}

File type distribution:
${Object.entries(typeDistribution).map(([ext, count]) => `- .${ext}: ${count} files`).join('\n')}

Key files found: ${keyFiles.map(f => f.relativePath).join(', ') || 'None'}

Create a concise project overview with:
1. **Project Type**: What kind of project is this (web app, CLI tool, library, etc)?
2. **Tech Stack**: Main technologies and frameworks used
3. **Structure**: Brief description of how the code is organized
4. **Key Directories**: What the main directories contain

Keep it concise (under 300 words). This will be used as context for an AI assistant.`;

  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const text = response.text || '';
  
  const header = `# ${folderName} - Project Memory

Last synced: ${new Date().toISOString()}
Files indexed: ${files.length}

---

`;

  const footer = `

---

## Directory Tree

\`\`\`
${tree}
\`\`\`

## Indexed Files

${Object.keys(entries).slice(0, 50).map(path => `- \`${path}\``).join('\n')}
${Object.keys(entries).length > 50 ? `\n... and ${Object.keys(entries).length - 50} more files` : ''}
`;

  return header + text + footer;
}

/**
 * Get human-readable file type from extension
 */
function getFileType(extension: string): string {
  const typeMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React Component',
    js: 'JavaScript',
    jsx: 'JavaScript React Component',
    md: 'Markdown',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    h: 'C Header',
    hpp: 'C++ Header',
    sh: 'Shell Script',
    bash: 'Bash Script',
    zsh: 'Zsh Script',
    sql: 'SQL',
    graphql: 'GraphQL',
    prisma: 'Prisma Schema',
    dockerfile: 'Dockerfile',
    txt: 'Text',
  };

  return typeMap[extension.toLowerCase()] || extension.toUpperCase();
}

/**
 * Truncate content to fit within token limits
 */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  
  // Try to truncate at a reasonable boundary
  const truncated = content.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  
  if (lastNewline > maxChars * 0.8) {
    return truncated.slice(0, lastNewline) + '\n\n... (truncated)';
  }
  
  return truncated + '\n\n... (truncated)';
}

/**
 * Build a simple directory tree string
 */
function buildDirectoryTree(paths: string[]): string {
  const dirs = new Set<string>();
  
  for (const path of paths) {
    const parts = path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      dirs.add(current);
    }
  }

  const sortedDirs = Array.from(dirs).sort();
  const lines: string[] = [];
  
  for (const dir of sortedDirs.slice(0, 30)) {
    const depth = dir.split('/').length - 1;
    const indent = '  '.repeat(depth);
    const name = dir.split('/').pop();
    lines.push(`${indent}${name}/`);
  }
  
  if (sortedDirs.length > 30) {
    lines.push(`... and ${sortedDirs.length - 30} more directories`);
  }

  return lines.join('\n') || '(no directories)';
}

/**
 * Get distribution of file types
 */
function getTypeDistribution(files: FileInfo[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  
  for (const file of files) {
    distribution[file.extension] = (distribution[file.extension] || 0) + 1;
  }
  
  // Sort by count descending
  return Object.fromEntries(
    Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  );
}
