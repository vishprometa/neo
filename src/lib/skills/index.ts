/**
 * Skills system for Neo
 * Discovers and loads SKILL.md files from workspace
 */
import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

export interface Skill {
  name: string;
  description: string;
  location: string;
  content: string;
}

// Parse frontmatter from markdown content
function parseFrontmatter(content: string): { data: Record<string, string>; content: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return { data: {}, content: content.trim() };
  }
  
  const frontmatterStr = match[1];
  const mainContent = match[2];
  
  // Simple YAML-like parsing for frontmatter
  const data: Record<string, string> = {};
  const lines = frontmatterStr.split('\n');
  
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }
  
  return { data, content: mainContent.trim() };
}

// Find all SKILL.md files in a directory recursively
async function findSkillFiles(dir: string, maxDepth: number = 3): Promise<string[]> {
  const skillFiles: string[] = [];
  
  async function scanDir(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    
    try {
      const entries = await readDir(currentDir);
      
      for (const entry of entries) {
        // Skip hidden directories and common non-relevant directories
        if (entry.name.startsWith('.') || 
            entry.name === 'node_modules' || 
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === '__pycache__') {
          continue;
        }
        
        const fullPath = await join(currentDir, entry.name);
        
        if (entry.isDirectory) {
          await scanDir(fullPath, depth + 1);
        } else if (entry.name.toLowerCase() === 'skill.md') {
          skillFiles.push(fullPath);
        }
      }
    } catch (err) {
      // Ignore permission errors and continue
      console.warn(`Failed to scan directory ${currentDir}:`, err);
    }
  }
  
  await scanDir(dir, 0);
  return skillFiles;
}

// Load a skill from a SKILL.md file
async function loadSkill(filePath: string): Promise<Skill | null> {
  try {
    const content = await readTextFile(filePath);
    const { data, content: mainContent } = parseFrontmatter(content);
    
    // Require name and description in frontmatter
    if (!data.name || !data.description) {
      console.warn(`Skill at ${filePath} missing name or description in frontmatter`);
      return null;
    }
    
    return {
      name: data.name,
      description: data.description,
      location: filePath,
      content: mainContent,
    };
  } catch (err) {
    console.error(`Failed to load skill from ${filePath}:`, err);
    return null;
  }
}

// Skill registry
let cachedSkills: Map<string, Skill> | null = null;
let lastWorkspaceDir: string | null = null;

/**
 * Discover and load all skills from workspace directories
 */
export async function discoverSkills(workspaceDir: string): Promise<Skill[]> {
  // Return cached skills if workspace hasn't changed
  if (cachedSkills && lastWorkspaceDir === workspaceDir) {
    return Array.from(cachedSkills.values());
  }
  
  const skills = new Map<string, Skill>();
  
  // Directories to search for skills
  const searchDirs: string[] = [];
  
  // Check for .neo/skills directory in workspace
  const neoSkillsDir = await join(workspaceDir, '.neo', 'skills');
  if (await exists(neoSkillsDir)) {
    searchDirs.push(neoSkillsDir);
  }
  
  // Check for skills directory in workspace root
  const rootSkillsDir = await join(workspaceDir, 'skills');
  if (await exists(rootSkillsDir)) {
    searchDirs.push(rootSkillsDir);
  }
  
  // Scan each directory for SKILL.md files
  for (const dir of searchDirs) {
    const skillFiles = await findSkillFiles(dir);
    
    for (const filePath of skillFiles) {
      const skill = await loadSkill(filePath);
      if (skill) {
        if (skills.has(skill.name)) {
          console.warn(`Duplicate skill name "${skill.name}" at ${filePath}, using first occurrence`);
        } else {
          skills.set(skill.name, skill);
        }
      }
    }
  }
  
  // Cache the results
  cachedSkills = skills;
  lastWorkspaceDir = workspaceDir;
  
  return Array.from(skills.values());
}

/**
 * Get a specific skill by name
 */
export async function getSkill(workspaceDir: string, name: string): Promise<Skill | undefined> {
  const skills = await discoverSkills(workspaceDir);
  return skills.find(s => s.name === name);
}

/**
 * Clear the skills cache
 */
export function clearSkillsCache() {
  cachedSkills = null;
  lastWorkspaceDir = null;
}

/**
 * Format skills for the system prompt
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }
  
  const skillList = skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
  
  return `
## Available Skills

The following skills are available in this workspace. To use a skill, call the \`use_skill\` tool with the skill name.

${skillList}
`;
}
