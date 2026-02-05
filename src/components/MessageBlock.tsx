/**
 * MessageBlock - Renders content blocks based on their format
 * Supports: text, tool_call, tool_result, reasoning, error
 */
import ReactMarkdown from 'react-markdown';
import { SkillBlock, ToolStatus } from './SkillBlock';
import type { ContentBlock, ToolCallBlockContent, ToolResultBlockContent } from '../lib/agent/types';
import { Brain, AlertCircle } from 'lucide-react';

interface MessageBlockProps {
  block: ContentBlock;
}

export function MessageBlock({ block }: MessageBlockProps) {
  switch (block.format) {
    case 'text':
      return <TextBlock content={block.content as string} />;
    
    case 'reasoning':
      return <ReasoningBlock content={block.content as string} />;
    
    case 'tool_call':
      return <ToolCallBlock block={block} />;
    
    case 'tool_result':
      return <ToolResultBlock block={block} />;
    
    case 'error':
      return <ErrorBlock content={block.content as string} />;
    
    default:
      return null;
  }
}

// Text block - renders markdown content
function TextBlock({ content }: { content: string }) {
  if (!content || !content.trim()) return null;
  
  return (
    <div className="message-assistant-content markdown-content">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

// Reasoning block - shows model's thinking process
function ReasoningBlock({ content }: { content: string }) {
  if (!content || !content.trim()) return null;
  
  return (
    <div className="my-3 rounded-xl bg-foreground/[0.02] border border-dashed border-foreground/8 p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
        <Brain className="h-3.5 w-3.5 opacity-60" />
        <span className="font-medium">Thinking</span>
      </div>
      <div className="text-sm text-muted-foreground/80 italic leading-relaxed">
        {content}
      </div>
    </div>
  );
}

// Tool call block - uses SkillBlock for display
function ToolCallBlock({ block }: { block: ContentBlock }) {
  const content = block.content as ToolCallBlockContent;
  
  // Map internal status to SkillBlock status
  const getStatus = (): ToolStatus => {
    switch (content.status) {
      case 'executing':
        return ToolStatus.EXECUTING;
      case 'completed':
        return ToolStatus.COMPLETED;
      case 'error':
        return ToolStatus.ERROR;
      default:
        return ToolStatus.EXECUTING; // pending shows as executing
    }
  };
  
  // Only show tool_call blocks that are executing (not completed/error - those have tool_result)
  if (content.status === 'completed' || content.status === 'error') {
    return null;
  }
  
  return (
    <SkillBlock
      id={block.id}
      name={content.name}
      status={getStatus()}
      args={content.args}
    />
  );
}

// Tool result block - shows completed tool execution
function ToolResultBlock({ block }: { block: ContentBlock }) {
  const content = block.content as ToolResultBlockContent;
  const metadata = block.metadata || {};
  const toolName = (metadata.tool as string) || 'Tool';
  const status = (metadata.status as string) === 'error' ? ToolStatus.ERROR : ToolStatus.COMPLETED;
  const executionTime = metadata.execution_time as number | undefined;
  
  return (
    <SkillBlock
      id={block.id}
      name={toolName}
      status={status}
      result={content.output}
      error={content.error}
      executionTime={executionTime || content.executionTime}
    />
  );
}

// Error block - shows error messages
function ErrorBlock({ content }: { content: string }) {
  return (
    <div className="my-3 rounded-xl bg-red-500/[0.05] border border-dashed border-red-500/20 p-3">
      <div className="flex items-center gap-2 text-red-400/80 text-xs mb-2">
        <AlertCircle className="h-3.5 w-3.5" />
        <span className="font-medium">Error</span>
      </div>
      <div className="text-sm text-red-400/80 leading-relaxed">
        {content}
      </div>
    </div>
  );
}
