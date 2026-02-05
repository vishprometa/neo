/**
 * Memory tools for Neo semantic filesystem
 * Provides tools to sync, read, write, and search memory
 */
import { z } from 'zod';
import { defineTool } from '../tool';
import {
  syncDirectory,
  readMemoryFile,
  writeJournalEntry,
  searchMemory,
  listMemoryFiles,
  getSyncStatus,
  loadMemoryContext,
} from '../../memory';

/** Extended tool context with API key */
interface ExtendedToolContext {
  sessionId: string;
  workspaceDir: string;
  callId: string;
  signal: AbortSignal;
  apiKey: string;
}

/**
 * Tool to sync/index the workspace directory
 */
export const SyncMemoryTool = defineTool('sync_memory', {
  description: `Sync and index the workspace directory to build semantic memory.

This tool scans all text files in the workspace and creates AI-generated summaries
stored in .neomemory/. Use this when:
- Starting work on a new project
- The user asks to "remember" or "learn" the codebase
- Files have been significantly changed and memory needs updating

The sync process:
1. Scans for text files (code, docs, configs)
2. Generates summaries for new/changed files
3. Creates an index.md with project overview`,
  parameters: z.object({
    force: z.boolean().optional().describe('Force re-sync all files, ignoring cache'),
  }),
  async execute(_params, ctx) {
    const extCtx = ctx as unknown as ExtendedToolContext;
    const apiKey = extCtx.apiKey;
    
    if (!apiKey) {
      throw new Error('API key not available for memory sync');
    }

    const result = await syncDirectory(ctx.workspaceDir, apiKey);

    return {
      title: 'Memory Sync',
      output: `Memory sync complete.
- Files indexed: ${result.indexed}
- Files skipped (unchanged): ${result.skipped}
- Errors: ${result.errors}

The workspace memory is now up to date. I can use this to answer questions about the codebase.`,
      metadata: { ...result, needsReload: true },
    };
  },
});

/**
 * Tool to read memory files
 */
export const ReadMemoryTool = defineTool('read_memory', {
  description: `Read a memory file from .neomemory/.

Use this to access:
- index.md - Project overview and structure
- files/<filename>.md - Summary of a specific file
- journal/<date>.md - Journal entries for a specific date

This provides semantic context about files without reading the full source code.`,
  parameters: z.object({
    path: z.string().describe('Path to memory file relative to .neomemory/ (e.g., "index.md", "files/readme-md.md", "journal/2026-02-05.md")'),
  }),
  async execute(params, ctx) {
    const content = await readMemoryFile(ctx.workspaceDir, params.path);

    if (content === null) {
      return {
        title: `Memory: ${params.path}`,
        output: `Memory file not found: ${params.path}

Available memory files can be listed with search_memory or check if memory has been synced.`,
        metadata: { found: false },
      };
    }

    return {
      title: `Memory: ${params.path}`,
      output: content,
      metadata: { found: true, length: content.length },
    };
  },
});

/**
 * Tool to write journal entries
 */
export const WriteMemoryTool = defineTool('write_memory', {
  description: `Write a journal entry to memory.

Journal entries are stored in .neomemory/journal/ with today's date as filename.
Use this to:
- Record important decisions or context
- Note things to remember about the project
- Save information the user wants to persist across sessions
- Document changes or discoveries

Each entry is timestamped and appended to the day's journal file.`,
  parameters: z.object({
    content: z.string().describe('The content to write to the journal'),
    title: z.string().optional().describe('Optional title for this entry'),
  }),
  async execute(params, ctx) {
    const entryContent = params.title 
      ? `### ${params.title}\n\n${params.content}`
      : params.content;

    const filePath = await writeJournalEntry(ctx.workspaceDir, entryContent);
    const fileName = filePath.split('/').pop();

    return {
      title: 'Journal Entry',
      output: `Journal entry saved to ${fileName}

Content:
${entryContent.slice(0, 200)}${entryContent.length > 200 ? '...' : ''}`,
      metadata: { file: fileName },
    };
  },
});

/**
 * Tool to search across memory
 */
export const SearchMemoryTool = defineTool('search_memory', {
  description: `Search across all memory files for a query.

Searches the index, file summaries, and journal entries for matching text.
Use this to:
- Find where something is discussed in the codebase
- Locate relevant files for a task
- Recall previous journal entries about a topic`,
  parameters: z.object({
    query: z.string().describe('The search query'),
  }),
  async execute(params, ctx) {
    const results = await searchMemory(ctx.workspaceDir, params.query);

    if (results.length === 0) {
      // Also check if memory is initialized
      const status = await getSyncStatus(ctx.workspaceDir);
      
      if (!status.initialized) {
        return {
          title: `Search: ${params.query}`,
          output: `No results found. Memory has not been synced yet.

Use sync_memory to index the workspace first.`,
          metadata: { count: 0, initialized: false },
        };
      }

      return {
        title: `Search: ${params.query}`,
        output: `No results found for "${params.query}" in memory.

Memory is synced with ${status.fileCount} files indexed.`,
        metadata: { count: 0, initialized: true },
      };
    }

    const output = results.map((r) => {
      const matchPreview = r.matches.slice(0, 3).map(m => `  - ${m.slice(0, 100)}`).join('\n');
      return `**${r.file}** (${r.matches.length} matches)\n${matchPreview}`;
    }).join('\n\n');

    return {
      title: `Search: ${params.query}`,
      output: `Found ${results.length} files with matches:\n\n${output}`,
      metadata: { count: results.length, files: results.map(r => r.file) },
    };
  },
});

/**
 * Tool to list all memory files
 */
export const ListMemoryTool = defineTool('list_memory', {
  description: `List all indexed memory files.

Shows all file summaries stored in .neomemory/files/.
Use this to see what files have been indexed.`,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const status = await getSyncStatus(ctx.workspaceDir);

    if (!status.initialized) {
      return {
        title: 'Memory Files',
        output: `Memory has not been synced yet.

Use sync_memory to index the workspace first.`,
        metadata: { initialized: false },
      };
    }

    const files = await listMemoryFiles(ctx.workspaceDir);

    if (files.length === 0) {
      return {
        title: 'Memory Files',
        output: `No file summaries found.

Last sync: ${new Date(status.lastSync).toISOString()}`,
        metadata: { count: 0, lastSync: status.lastSync },
      };
    }

    const output = `Last sync: ${new Date(status.lastSync).toISOString()}
Files indexed: ${files.length}

${files.slice(0, 50).join('\n')}${files.length > 50 ? `\n... and ${files.length - 50} more` : ''}`;

    return {
      title: 'Memory Files',
      output,
      metadata: { count: files.length, lastSync: status.lastSync },
    };
  },
});

/**
 * Tool to get full memory context (for debugging)
 */
export const GetMemoryContextTool = defineTool('get_memory_context', {
  description: `Get the full memory context that is injected into the system prompt.

This shows exactly what memory information is available to the assistant.
Useful for debugging or understanding what context is being used.`,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const context = await loadMemoryContext(ctx.workspaceDir);

    if (!context) {
      return {
        title: 'Memory Context',
        output: 'No memory context available. Run sync_memory first.',
        metadata: { hasContext: false },
      };
    }

    return {
      title: 'Memory Context',
      output: context.slice(0, 5000) + (context.length > 5000 ? '\n\n... (truncated)' : ''),
      metadata: { hasContext: true, length: context.length },
    };
  },
});
