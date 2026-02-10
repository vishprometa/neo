import { Circle, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
}

interface TodoBlockProps {
  todos: TodoItem[];
  title?: string;
  executionTime?: number;
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case 'in_progress':
      return <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />;
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
    case 'pending':
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
  }
}

function PriorityBadge({ priority }: { priority: TodoItem['priority'] }) {
  if (!priority) return null;

  const colors = {
    high: 'text-red-400/80 bg-red-500/10',
    medium: 'text-amber-400/80 bg-amber-500/10',
    low: 'text-muted-foreground/60 bg-foreground/5',
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${colors[priority]}`}>
      {priority}
    </span>
  );
}

export function TodoBlock({ todos, title, executionTime }: TodoBlockProps) {
  if (!todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="my-3 rounded-xl bg-foreground/[0.03] border border-foreground/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium text-sm">{title || 'Tasks'}</span>
          <span className="text-xs text-muted-foreground">
            {completed}/{total}
          </span>
        </div>
        {executionTime != null && executionTime > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            <Clock className="h-3 w-3" />
            {executionTime}ms
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-foreground/5">
        <div
          className="h-full bg-emerald-500/50 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo items */}
      <div className="px-1.5 py-1.5">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={`flex items-start gap-2.5 px-2 py-1.5 rounded-lg transition-colors ${
              todo.status === 'completed'
                ? 'opacity-60'
                : todo.status === 'cancelled'
                  ? 'opacity-40'
                  : ''
            }`}
          >
            <div className="mt-0.5">
              <StatusIcon status={todo.status} />
            </div>
            <div className="flex-1 min-w-0">
              <span
                className={`text-sm leading-snug ${
                  todo.status === 'completed'
                    ? 'line-through text-muted-foreground'
                    : todo.status === 'cancelled'
                      ? 'line-through text-muted-foreground/60'
                      : todo.status === 'in_progress'
                        ? 'text-foreground'
                        : 'text-foreground/80'
                }`}
              >
                {todo.content}
              </span>
            </div>
            <PriorityBadge priority={todo.priority} />
          </div>
        ))}
      </div>
    </div>
  );
}
