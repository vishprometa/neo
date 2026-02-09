import { useState } from 'react';
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Clock,
} from 'lucide-react';

export const ToolStatus = {
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;

export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];

interface SkillBlockProps {
  id: string;
  name: string;
  status: ToolStatus;
  result?: string;
  error?: string;
  args?: Record<string, unknown>;
  executionTime?: number;
}

export function SkillBlock({
  name,
  status,
  result,
  error,
  args,
  executionTime,
}: SkillBlockProps) {
  const [isExpanded, setIsExpanded] = useState(status === ToolStatus.EXECUTING);
  const [copied, setCopied] = useState(false);

  const displayContent = error || result || '';

  const getStatusText = () => {
    switch (status) {
      case ToolStatus.EXECUTING:
        return 'Running...';
      case ToolStatus.COMPLETED:
        return 'Completed';
      case ToolStatus.ERROR:
        return 'Failed';
      default:
        return '';
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const shouldTruncate = displayContent.length > 500;
  const truncatedContent = shouldTruncate && !isExpanded
    ? displayContent.substring(0, 500) + '...'
    : displayContent;

  return (
    <div className="my-3 rounded-xl bg-foreground/[0.03] border border-dashed border-foreground/10 overflow-hidden transition-all duration-200">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Expand/Collapse or Loading */}
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {status === ToolStatus.EXECUTING ? (
            <Loader2 className="h-4 w-4 animate-spin opacity-50" />
          ) : isExpanded ? (
            <ChevronUp className="h-4 w-4 opacity-50" />
          ) : (
            <ChevronDown className="h-4 w-4 opacity-50" />
          )}
        </div>

        {/* Tool name and status */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium text-sm truncate">{name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-md bg-foreground/[0.04] text-muted-foreground shrink-0">
            {getStatusText()}
          </span>
        </div>

        {/* Right side - time and copy */}
        <div className="flex items-center gap-2 shrink-0">
          {executionTime && executionTime > 0 && status !== ToolStatus.EXECUTING && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {executionTime}ms
            </span>
          )}
          {displayContent.trim() && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              title="Copy output"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expandable content */}
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isExpanded ? 'max-h-[600px]' : 'max-h-0'
        }`}
      >
        <div className="px-3 pb-3 space-y-3">
          {/* Arguments */}
          {args && Object.keys(args).length > 0 && (
            <div className="pt-2 border-t border-foreground/5">
              <p className="text-xs text-muted-foreground mb-2">Arguments</p>
              <pre className="text-xs font-mono bg-foreground/[0.03] rounded-lg p-3 overflow-x-auto text-muted-foreground">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {displayContent.trim() && (
            <div className={args && Object.keys(args).length > 0 ? '' : 'pt-2 border-t border-foreground/5'}>
              <p className="text-xs text-muted-foreground mb-2">
                {error ? 'Error' : 'Output'}
              </p>
              <pre className={`text-xs font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all ${
                error 
                  ? 'bg-red-500/5 text-red-400/90' 
                  : 'bg-foreground/[0.03] text-foreground/80'
              }`}>
                {truncatedContent}
              </pre>
              {shouldTruncate && !isExpanded && (
                <button
                  onClick={() => setIsExpanded(true)}
                  className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
                >
                  Show more...
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar for executing */}
      {status === ToolStatus.EXECUTING && (
        <div className="h-0.5 bg-foreground/5 overflow-hidden">
          <div className="h-full w-1/3 bg-foreground/20 animate-progress-indeterminate" />
        </div>
      )}
    </div>
  );
}
