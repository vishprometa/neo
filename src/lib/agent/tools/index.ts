/**
 * Register all tools for Neo coding assistant
 */
import { registry } from '../registry';
import {
  ReadFileTool,
  WriteFileTool,
  ListDirectoryTool,
  GlobTool,
  GrepTool,
  EditFileTool,
} from './file-tools';
import {
  SyncMemoryTool,
  ReadMemoryTool,
  WriteMemoryTool,
  SearchMemoryTool,
  ListMemoryTool,
  GetMemoryContextTool,
} from './memory-tools';
import {
  listSkillsTool,
  useSkillTool,
} from './skill-tools';
import { ShellTool } from './shell-tool';
import { WebFetchTool, WebSearchTool } from './web-tools';

let registered = false;

export function registerTools() {
  if (registered) return;
  
  // File tools
  registry.register(ReadFileTool);
  registry.register(WriteFileTool);
  registry.register(ListDirectoryTool);
  registry.register(GlobTool);
  registry.register(GrepTool);
  registry.register(EditFileTool);
  
  // Memory tools
  registry.register(SyncMemoryTool);
  registry.register(ReadMemoryTool);
  registry.register(WriteMemoryTool);
  registry.register(SearchMemoryTool);
  registry.register(ListMemoryTool);
  registry.register(GetMemoryContextTool);
  
  // Skill tools
  registry.register(listSkillsTool);
  registry.register(useSkillTool);
  
  // Shell tool
  registry.register(ShellTool);
  
  // Web tools
  registry.register(WebFetchTool);
  registry.register(WebSearchTool);
  
  registered = true;
}
