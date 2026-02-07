/**
 * Register all tools for Neo coding assistant
 * Mirrors erpai-cli tool registration pattern
 */
import { registry } from '../registry';

// File tools (read, read_many_files, write, edit, multiedit, replace, ls, glob, grep)
import {
  ReadFileTool,
  ReadFileAliasTool,
  ReadManyFilesTool,
  WriteFileTool,
  EditFileTool,
  MultiEditTool,
  ReplaceTool,
  ListDirectoryTool,
  GlobTool,
  GrepTool,
} from './file-tools';

// Memory tools
import {
  SyncMemoryTool,
  ReadMemoryTool,
  WriteMemoryTool,
  SearchMemoryTool,
  ListMemoryTool,
  GetMemoryContextTool,
} from './memory-tools';

// Skill tools
import {
  listSkillsTool,
  useSkillTool,
} from './skill-tools';

// Shell tool
import { ShellTool } from './shell-tool';

// Web tools
import { WebFetchTool, WebSearchTool } from './web-tools';

// Todo tools
import { TodoWriteTool, TodoReadTool } from './todo-tools';

// Question tool
import { QuestionTool } from './question-tool';

let registered = false;

export function registerTools() {
  if (registered) return;

  // ── File tools ──────────────────────────────────────────────────────
  registry.register(ReadFileTool);
  registry.register(ReadFileAliasTool);
  registry.register(ReadManyFilesTool);
  registry.register(WriteFileTool);
  registry.register(EditFileTool);
  registry.register(MultiEditTool);
  registry.register(ReplaceTool);
  registry.register(ListDirectoryTool);
  registry.register(GlobTool);
  registry.register(GrepTool);

  // ── Shell tool ──────────────────────────────────────────────────────
  registry.register(ShellTool);

  // ── Web tools ───────────────────────────────────────────────────────
  registry.register(WebFetchTool);
  registry.register(WebSearchTool);

  // ── Memory tools ────────────────────────────────────────────────────
  registry.register(SyncMemoryTool);
  registry.register(ReadMemoryTool);
  registry.register(WriteMemoryTool);
  registry.register(SearchMemoryTool);
  registry.register(ListMemoryTool);
  registry.register(GetMemoryContextTool);

  // ── Skill tools ─────────────────────────────────────────────────────
  registry.register(listSkillsTool);
  registry.register(useSkillTool);

  // ── Todo tools ──────────────────────────────────────────────────────
  registry.register(TodoWriteTool);
  registry.register(TodoReadTool);

  // ── Question tool ───────────────────────────────────────────────────
  registry.register(QuestionTool);

  registered = true;
}
