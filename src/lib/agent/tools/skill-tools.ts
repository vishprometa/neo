/**
 * Skill tools for Neo
 * Allows the agent to discover and use skills
 */
import { z } from 'zod';
import { defineTool, type ToolContext } from '../tool';
import { discoverSkills, getSkill } from '../../skills';

/**
 * List available skills in the workspace
 */
export const listSkillsTool = defineTool('list_skills', {
  description: 'List all available skills in the workspace. Skills are reusable prompts and instructions defined in SKILL.md files.',
  parameters: z.object({}),
  execute: async (_args: Record<string, never>, ctx: ToolContext) => {
    const skills = await discoverSkills(ctx.workspaceDir);
    
    if (skills.length === 0) {
      return {
        title: 'No skills found',
        output: 'No skills found in this workspace. Skills can be defined by creating SKILL.md files in a `.neo/skills/` or `skills/` directory.',
      };
    }
    
    const skillList = skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
    
    return {
      title: `Found ${skills.length} skill(s)`,
      output: `Found ${skills.length} skill(s):\n\n${skillList}\n\nUse the \`use_skill\` tool with a skill name to load its content.`,
    };
  },
});

/**
 * Use a skill by name - loads its content for the agent to follow
 */
export const useSkillTool = defineTool('use_skill', {
  description: 'Load and use a skill by name. Returns the skill\'s instructions which should be followed.',
  parameters: z.object({
    name: z.string().describe('The name of the skill to use'),
  }),
  execute: async (args: { name: string }, ctx: ToolContext) => {
    const skill = await getSkill(ctx.workspaceDir, args.name);
    
    if (!skill) {
      const skills = await discoverSkills(ctx.workspaceDir);
      const availableNames = skills.map(s => s.name).join(', ');
      
      return {
        title: `Skill "${args.name}" not found`,
        output: `Skill "${args.name}" not found.${availableNames ? ` Available skills: ${availableNames}` : ' No skills are available in this workspace.'}`,
      };
    }
    
    return {
      title: `Loaded skill: ${skill.name}`,
      output: `# Skill: ${skill.name}\n\n${skill.content}\n\n---\n*Loaded from: ${skill.location}*`,
    };
  },
});
