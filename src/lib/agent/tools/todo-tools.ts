/**
 * Todo tools for Neo coding assistant
 * Provides task tracking capabilities within a session
 * Ported from erpai-cli vendor tools
 */
import { z } from 'zod';
import { defineTool } from '../tool';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';

const TodoStatus = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);

const TodoItem = z.object({
  id: z.string().describe('Unique identifier for the todo'),
  content: z.string().describe('Description of the todo item'),
  status: TodoStatus.describe('Current status of the todo'),
  priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level'),
});

type Todo = z.infer<typeof TodoItem>;

/** Path to todo storage file within .neomemory */
async function getTodoPath(workspaceDir: string): Promise<string> {
  return join(workspaceDir, '.neomemory', 'todos.json');
}

async function loadTodos(workspaceDir: string): Promise<Todo[]> {
  const todoPath = await getTodoPath(workspaceDir);
  try {
    const fileExists = await exists(todoPath);
    if (!fileExists) return [];
    const content = await readTextFile(todoPath);
    return JSON.parse(content) as Todo[];
  } catch {
    return [];
  }
}

async function saveTodos(workspaceDir: string, todos: Todo[]): Promise<void> {
  const todoPath = await getTodoPath(workspaceDir);
  const dir = await dirname(todoPath);
  const dirExists = await exists(dir);
  if (!dirExists) {
    await mkdir(dir, { recursive: true });
  }
  await writeTextFile(todoPath, JSON.stringify(todos, null, 2));
}

function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) return 'No todos found.';

  const statusIcons: Record<string, string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  return todos.map((t) => {
    const icon = statusIcons[t.status] || '[ ]';
    const priority = t.priority ? ` (${t.priority})` : '';
    return `${icon} ${t.id}: ${t.content}${priority}`;
  }).join('\n');
}

export const TodoWriteTool = defineTool('todowrite', {
  description: `Create and manage a structured task list. The task list is displayed to the user in a sidebar panel that updates in real-time.

IMPORTANT WORKFLOW:
1. At the START of a multi-step task, call todowrite with ALL planned tasks (status: pending).
2. Before starting each task, call todowrite to set that task to in_progress.
3. Immediately after completing each task, call todowrite to mark it completed.
4. KEEP WORKING through every task until ALL are completed — do NOT stop mid-list or ask the user which to do next unless genuinely ambiguous.
5. Only have ONE task as in_progress at a time.

Task states: pending, in_progress, completed, cancelled.
Create specific, actionable items. The user sees this list live — keep it updated as you work.`,
  parameters: z.object({
    todos: z.array(TodoItem).describe('The updated todo list'),
  }),
  async execute(params, ctx) {
    await saveTodos(ctx.workspaceDir, params.todos);

    const active = params.todos.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    const completed = params.todos.filter((t) => t.status === 'completed');

    return {
      title: `${active.length} active, ${completed.length} done`,
      output: formatTodoList(params.todos),
      metadata: {
        total: params.todos.length,
        active: active.length,
        completed: completed.length,
        todos: params.todos,
      },
    };
  },
});

export const TodoReadTool = defineTool('todoread', {
  description: `Read the current todo list to check progress and status of tasks.`,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const todos = await loadTodos(ctx.workspaceDir);

    const active = todos.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    const completed = todos.filter((t) => t.status === 'completed');

    return {
      title: `${active.length} active, ${completed.length} done`,
      output: formatTodoList(todos),
      metadata: {
        total: todos.length,
        active: active.length,
        completed: completed.length,
        todos,
      },
    };
  },
});
