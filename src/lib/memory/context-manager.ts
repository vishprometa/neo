/**
 * Context Manager for Neo
 * Manages the 3-tier memory system inspired by gemini-cli:
 * 1. Global Memory (Tier 1): ~/.neo/NEO.md - User-level instructions
 * 2. Environment Memory (Tier 2): Project root NEO.md files - Project-specific
 * 3. JIT Memory (Tier 3): On-demand loading when paths are accessed
 */

import { readTextFile, exists, readDir } from '@tauri-apps/plugin-fs';
import { join, dirname, homeDir } from '@tauri-apps/api/path';

export interface MemoryTier {
  level: 1 | 2 | 3;
  name: string;
  content: string;
  source: string;
  loadedAt: number;
}

export interface ContextManagerOptions {
  workspaceDir: string;
  /** File names to look for memory files */
  memoryFileNames?: string[];
  /** Maximum depth for JIT memory traversal */
  maxJitDepth?: number;
}

const DEFAULT_MEMORY_FILE_NAMES = ['NEO.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules'];

/**
 * Context Manager handles loading and managing memory tiers
 */
export class ContextManager {
  private workspaceDir: string;
  private memoryFileNames: string[];
  private maxJitDepth: number;
  
  private globalMemory: MemoryTier | null = null;
  private environmentMemory: MemoryTier[] = [];
  private jitMemory: Map<string, MemoryTier> = new Map();
  private loadedPaths: Set<string> = new Set();

  constructor(options: ContextManagerOptions) {
    this.workspaceDir = options.workspaceDir;
    this.memoryFileNames = options.memoryFileNames || DEFAULT_MEMORY_FILE_NAMES;
    this.maxJitDepth = options.maxJitDepth ?? 5;
  }

  /**
   * Initialize the context manager and load Tier 1 & 2 memory
   */
  async initialize(): Promise<void> {
    // Load Tier 1: Global Memory
    await this.loadGlobalMemory();
    
    // Load Tier 2: Environment Memory
    await this.loadEnvironmentMemory();
  }

  /**
   * Load Tier 1: Global Memory from ~/.neo/
   */
  private async loadGlobalMemory(): Promise<void> {
    try {
      const home = await homeDir();
      const neoDir = await join(home, '.neo');
      
      for (const fileName of this.memoryFileNames) {
        const filePath = await join(neoDir, fileName);
        if (await exists(filePath)) {
          const content = await readTextFile(filePath);
          this.globalMemory = {
            level: 1,
            name: 'Global Memory',
            content,
            source: filePath,
            loadedAt: Date.now(),
          };
          this.loadedPaths.add(filePath);
          return;
        }
      }
    } catch {
      // Global memory is optional
    }
  }

  /**
   * Load Tier 2: Environment Memory from project root upward
   */
  private async loadEnvironmentMemory(): Promise<void> {
    const memories: MemoryTier[] = [];
    let currentDir = this.workspaceDir;
    const home = await homeDir();
    
    // Walk up from workspace to root (but not past home)
    let depth = 0;
    while (currentDir && depth < 10) {
      depth++;
      
      for (const fileName of this.memoryFileNames) {
        try {
          const filePath = await join(currentDir, fileName);
          
          if (this.loadedPaths.has(filePath)) continue;
          
          if (await exists(filePath)) {
            const content = await readTextFile(filePath);
            memories.push({
              level: 2,
              name: `Project Memory (${fileName})`,
              content,
              source: filePath,
              loadedAt: Date.now(),
            });
            this.loadedPaths.add(filePath);
          }
        } catch {
          // Continue if file can't be read
        }
      }
      
      // Move up one directory
      const parent = await dirname(currentDir);
      if (parent === currentDir || parent === home) break;
      currentDir = parent;
    }
    
    // Reverse so most specific (workspace) is last
    this.environmentMemory = memories.reverse();
  }

  /**
   * Load Tier 3: JIT Memory when a path is accessed
   * Loads memory files from the accessed path up to workspace root
   */
  async loadJitMemory(accessedPath: string): Promise<MemoryTier[]> {
    const newMemories: MemoryTier[] = [];
    
    // Get directory of the accessed path
    let currentDir = accessedPath;
    try {
      const pathStat = await exists(accessedPath);
      if (pathStat) {
        // Check if it's a file
        currentDir = await dirname(accessedPath);
      }
    } catch {
      return [];
    }
    
    // Walk up from accessed path to workspace
    let depth = 0;
    while (
      currentDir &&
      currentDir.startsWith(this.workspaceDir) &&
      depth < this.maxJitDepth
    ) {
      depth++;
      
      for (const fileName of this.memoryFileNames) {
        try {
          const filePath = await join(currentDir, fileName);
          
          if (this.loadedPaths.has(filePath)) continue;
          if (this.jitMemory.has(filePath)) continue;
          
          if (await exists(filePath)) {
            const content = await readTextFile(filePath);
            const memory: MemoryTier = {
              level: 3,
              name: `JIT Memory (${fileName})`,
              content,
              source: filePath,
              loadedAt: Date.now(),
            };
            this.jitMemory.set(filePath, memory);
            newMemories.push(memory);
          }
        } catch {
          // Continue if file can't be read
        }
      }
      
      // Move up one directory
      const parent = await dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
    
    return newMemories;
  }

  /**
   * Get all loaded memory as a combined context string
   */
  getFullContext(): string {
    const parts: string[] = [];
    
    // Tier 1: Global
    if (this.globalMemory) {
      parts.push(`## Global Instructions\n\n${this.globalMemory.content}`);
    }
    
    // Tier 2: Environment
    for (const memory of this.environmentMemory) {
      parts.push(`## Project Instructions (${memory.source})\n\n${memory.content}`);
    }
    
    // Tier 3: JIT
    for (const memory of this.jitMemory.values()) {
      parts.push(`## Context Instructions (${memory.source})\n\n${memory.content}`);
    }
    
    return parts.join('\n\n---\n\n');
  }

  /**
   * Get memory for a specific tier
   */
  getMemoryByTier(tier: 1 | 2 | 3): MemoryTier[] {
    switch (tier) {
      case 1:
        return this.globalMemory ? [this.globalMemory] : [];
      case 2:
        return [...this.environmentMemory];
      case 3:
        return Array.from(this.jitMemory.values());
    }
  }

  /**
   * Get all loaded memory
   */
  getAllMemory(): MemoryTier[] {
    const all: MemoryTier[] = [];
    if (this.globalMemory) all.push(this.globalMemory);
    all.push(...this.environmentMemory);
    all.push(...this.jitMemory.values());
    return all;
  }

  /**
   * Refresh all memory (reload from disk)
   */
  async refresh(): Promise<void> {
    this.loadedPaths.clear();
    this.jitMemory.clear();
    this.globalMemory = null;
    this.environmentMemory = [];
    
    await this.initialize();
  }

  /**
   * Clear JIT memory (keeps global and environment)
   */
  clearJitMemory(): void {
    this.jitMemory.clear();
  }
}

/**
 * Create and initialize a context manager
 */
export async function createContextManager(workspaceDir: string): Promise<ContextManager> {
  const manager = new ContextManager({ workspaceDir });
  await manager.initialize();
  return manager;
}
