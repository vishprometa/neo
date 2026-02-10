import { useMemo } from 'react';
import { Circle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { Message } from '../lib/agent';
import type { ContentBlock } from '../lib/agent/types';

interface TaskSidebarProps {
  messages: Message[];
}

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  const size = 'h-3.5 w-3.5 shrink-0';
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={`${size} text-emerald-500`} />;
    case 'in_progress':
      return <Loader2 className={`${size} text-blue-400 animate-spin`} />;
    case 'cancelled':
      return <XCircle className={`${size} text-muted-foreground/50`} />;
    case 'pending':
    default:
      return <Circle className={`${size} text-muted-foreground/40`} />;
  }
}

/**
 * Sidebar that shows the latest task list state across all messages.
 * Compact layout — one line per task with small icons.
 */
export function TaskSidebar({ messages }: TaskSidebarProps) {
  const latestTodo = useMemo(() => {
    let latest: ContentBlock | null = null;

    for (const message of messages) {
      if (message.role !== 'assistant' || !message.blocks) continue;
      for (const block of message.blocks) {
        if (block.format !== 'tool_result') continue;
        const toolName = (block.metadata?.tool as string) || '';
        if ((toolName === 'todowrite' || toolName === 'todoread') && block.metadata?.todos) {
          latest = block;
        }
      }
    }

    return latest;
  }, [messages]);

  if (!latestTodo) return null;

  const meta = latestTodo.metadata!;
  const todos = meta.todos as TodoItem[];

  if (!todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="task-sidebar">
      {/* Header */}
      <div className="task-sidebar-header">
        <span className="task-sidebar-title">Tasks</span>
        <span className="task-sidebar-count">{completed}/{total}</span>
      </div>

      {/* Progress bar */}
      <div className="task-sidebar-progress">
        <div
          className="task-sidebar-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Compact task list */}
      <div className="task-sidebar-list">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={`task-sidebar-item ${
              todo.status === 'completed' ? 'task-done' :
              todo.status === 'cancelled' ? 'task-cancelled' :
              todo.status === 'in_progress' ? 'task-active' : ''
            }`}
          >
            <StatusIcon status={todo.status} />
            <span className="task-sidebar-item-text">{todo.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
