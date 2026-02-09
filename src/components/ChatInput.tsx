import { useRef, useEffect, useState, useCallback } from 'react';
import {
  ArrowRight,
  Square,
  ChevronDown,
  MessageSquare,
  Zap,
  FileText,
  Folder,
  Plus,
} from 'lucide-react';
import { useFileSuggestions, type FileSuggestion } from '../hooks/useFileSuggestions';

type ModelType = 'fast' | 'thinking';

interface ModelOption {
  label: string;
  value: ModelType;
  description: string;
  icon: typeof MessageSquare;
  color: 'green' | 'amber';
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    label: 'Fast',
    value: 'fast',
    description: 'Quick responses',
    icon: Zap,
    color: 'amber',
  },
  {
    label: 'Thinking',
    value: 'thinking',
    description: 'Deep reasoning',
    icon: MessageSquare,
    color: 'green',
  },
];

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isProcessing: boolean;
  disabled?: boolean;
  selectedModel?: ModelType;
  onModelChange?: (model: ModelType) => void;
  workspaceDir?: string | null;
}

interface MentionState {
  isActive: boolean;
  query: string;
  startIndex: number;
  type: 'file' | null;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  isProcessing,
  disabled = false,
  selectedModel = 'fast',
  onModelChange,
  workspaceDir,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelMenuPosition, setModelMenuPosition] = useState<'top' | 'bottom'>('top');
  
  // Mention state
  const [mentionState, setMentionState] = useState<MentionState>({
    isActive: false,
    query: '',
    startIndex: -1,
    type: null,
  });

  // File suggestions
  const {
    suggestions,
    isLoading: isSuggestionsLoading,
    selectedIndex,
    setSelectedIndex,
    searchFiles,
    clearSuggestions,
    selectNext,
    selectPrev,
  } = useFileSuggestions({ workspaceDir: workspaceDir ?? null, maxSuggestions: 8 });

  useEffect(() => {
    if (textareaRef.current) {
      autoResizeTextarea(textareaRef.current);
    }
  }, [value]);

  // Handle clicks outside model menu
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showModelMenu && menuRef.current) {
        if (!menuRef.current.contains(event.target as Node)) {
          setShowModelMenu(false);
        }
      }
      // Close suggestions when clicking outside
      if (mentionState.isActive && suggestionsRef.current) {
        if (!suggestionsRef.current.contains(event.target as Node) &&
            event.target !== textareaRef.current) {
          closeMention();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelMenu, mentionState.isActive]);

  // Search files when mention query changes
  useEffect(() => {
    if (mentionState.isActive && mentionState.type === 'file') {
      searchFiles(mentionState.query);
    }
  }, [mentionState.isActive, mentionState.query, mentionState.type, searchFiles]);

  const autoResizeTextarea = (textarea: HTMLTextAreaElement) => {
    const maxHeight = 150;
    const minHeight = 40;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const scrollTop = textarea.scrollTop;

    textarea.style.height = 'auto';
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';

    textarea.setSelectionRange(selectionStart, selectionEnd);
    textarea.scrollTop = scrollTop;
  };

  const closeMention = useCallback(() => {
    setMentionState({ isActive: false, query: '', startIndex: -1, type: null });
    clearSuggestions();
  }, [clearSuggestions]);

  const insertMention = useCallback((suggestion: FileSuggestion) => {
    const beforeMention = value.slice(0, mentionState.startIndex);
    const afterMention = value.slice(mentionState.startIndex + mentionState.query.length + 1); // +1 for '@'
    
    // Add trailing slash for directories
    const path = suggestion.isDirectory ? suggestion.path + '/' : suggestion.path;
    const newValue = `${beforeMention}@${path} ${afterMention}`;
    
    onChange(newValue);
    closeMention();

    // Focus textarea and move cursor after the mention
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const cursorPos = beforeMention.length + path.length + 2; // @path + space
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }, [value, mentionState.startIndex, mentionState.query, onChange, closeMention]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle mention navigation
    if (mentionState.isActive && suggestions.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          selectNext();
          return;
        case 'ArrowUp':
          e.preventDefault();
          selectPrev();
          return;
        case 'Enter':
          if (!e.shiftKey) {
            e.preventDefault();
            insertMention(suggestions[selectedIndex]);
            return;
          }
          break;
        case 'Tab':
          e.preventDefault();
          insertMention(suggestions[selectedIndex]);
          return;
        case 'Escape':
          e.preventDefault();
          closeMention();
          return;
      }
    }

    // Regular submit
    if (!disabled && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (!mentionState.isActive) {
        e.preventDefault();
        handleSend();
      }
    }

    // Escape to close mention
    if (e.key === 'Escape' && mentionState.isActive) {
      e.preventDefault();
      closeMention();
    }
  };

  const handleInputChange = (newValue: string) => {
    onChange(newValue);

    // Check for @ mention trigger
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);

    // Look for @path pattern (@ followed by non-whitespace)
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_.~\-\/]*)$/);
    
    if (atMatch) {
      const query = atMatch[1];
      const startIndex = cursorPos - query.length - 1; // -1 for '@'
      
      setMentionState({
        isActive: true,
        query,
        startIndex,
        type: 'file',
      });
    } else if (mentionState.isActive) {
      // Check if we're still in a mention (no space after @)
      const lastAtIdx = textBeforeCursor.lastIndexOf('@');
      if (lastAtIdx === -1) {
        closeMention();
      } else {
        const afterAt = textBeforeCursor.slice(lastAtIdx + 1);
        // Close if there's a space after the path
        if (/\s/.test(afterAt) && afterAt.includes(' ')) {
          closeMention();
        }
      }
    }

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        autoResizeTextarea(textareaRef.current);
      }
    });
  };

  // Insert @ trigger
  const handleAtButtonClick = () => {
    if (!textareaRef.current) return;
    
    const cursorPos = textareaRef.current.selectionStart;
    const newValue = value.slice(0, cursorPos) + '@' + value.slice(cursorPos);
    onChange(newValue);
    
    // Set mention state
    setMentionState({
      isActive: true,
      query: '',
      startIndex: cursorPos,
      type: 'file',
    });

    // Focus and position cursor
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos + 1, cursorPos + 1);
      }
    });
  };

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSubmit();
  };

  const handleModelClick = () => {
    if (!showModelMenu && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceAbove = rect.top;
      const spaceBelow = viewportHeight - rect.bottom;
      const menuHeight = 100;

      if (spaceBelow >= menuHeight) {
        setModelMenuPosition('bottom');
      } else if (spaceAbove >= menuHeight) {
        setModelMenuPosition('top');
      } else {
        setModelMenuPosition('bottom');
      }
    }
    setShowModelMenu(!showModelMenu);
  };

  const handleModelSelect = (model: ModelType) => {
    onModelChange?.(model);
    setShowModelMenu(false);
  };

  const currentModel = MODEL_OPTIONS.find((m) => m.value === selectedModel) || MODEL_OPTIONS[0];

  const getPlaceholderText = () => {
    return 'Type / for commands';
  };

  const getFileIcon = (suggestion: FileSuggestion) => {
    if (suggestion.isDirectory) {
      return <Folder size={14} className="text-amber-500" />;
    }
    
    const ext = suggestion.extension?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return <FileText size={14} className="text-blue-500" />;
      case 'js':
      case 'jsx':
        return <FileText size={14} className="text-yellow-500" />;
      case 'json':
        return <FileText size={14} className="text-green-500" />;
      case 'md':
        return <FileText size={14} className="text-purple-500" />;
      default:
        return <FileText size={14} className="text-gray-500" />;
    }
  };

  return (
    <div ref={containerRef} className="chat-input-container relative">
      <div className="chat-input-wrapper">
        <div className="chat-input-main-box">
          {/* Input Area */}
          <div className="chat-input-textarea-wrapper relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={getPlaceholderText()}
              disabled={disabled}
              rows={1}
              className="chat-input-textarea"
            />
            
            {/* @ Mention Suggestions Dropdown */}
            {mentionState.isActive && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="mention-suggestions"
              >
                <div className="mention-suggestions-header">
                  <FileText size={12} />
                  <span>Files & Folders</span>
                  {isSuggestionsLoading && (
                    <span className="mention-loading">...</span>
                  )}
                </div>
                <div className="mention-suggestions-list">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.path}
                      className={`mention-suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
                      onClick={() => insertMention(suggestion)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      {getFileIcon(suggestion)}
                      <span className="mention-suggestion-name">{suggestion.name}</span>
                      {suggestion.path !== suggestion.name && (
                        <span className="mention-suggestion-path">{suggestion.path}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="mention-suggestions-footer">
                  <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close
                </div>
              </div>
            )}

            {/* Empty state when no suggestions found */}
            {mentionState.isActive && mentionState.query && suggestions.length === 0 && !isSuggestionsLoading && (
              <div ref={suggestionsRef} className="mention-suggestions">
                <div className="mention-suggestions-empty">
                  No files matching "{mentionState.query}"
                </div>
              </div>
            )}
          </div>

          {/* Bottom Controls */}
          <div className="chat-input-controls">
            <div className="chat-input-controls-left">
              {/* Folder name display */}
              {workspaceDir && (
                <div className="cowork-folder-indicator">
                  <Folder size={12} />
                  <span>{workspaceDir.replace(/^\/Users\/[^/]+/, '~')}</span>
                </div>
              )}

              {/* @ Mention Button */}
              {workspaceDir && (
                <button
                  onClick={handleAtButtonClick}
                  className="chat-at-btn"
                  title="Add file reference @{path}"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>

            <div className="chat-input-controls-right">
              {/* Model Dropdown */}
              <div ref={menuRef} className="relative model-menu">
                <button
                  onClick={handleModelClick}
                  className="cowork-model-btn"
                >
                  <span>{currentModel.label === 'Fast' ? 'Flash' : 'Thinking'}</span>
                  <ChevronDown size={12} className="opacity-60" />
                </button>

                {/* Model Menu */}
                {showModelMenu && (
                  <div
                    className={`chat-model-menu ${modelMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
                  >
                    {MODEL_OPTIONS.map((model) => {
                      const Icon = model.icon;
                      return (
                        <button
                          key={model.value}
                          onClick={() => handleModelSelect(model.value)}
                          className={`chat-model-menu-item ${model.color === 'green' ? 'chat-model-menu-item-green' : 'chat-model-menu-item-amber'}`}
                        >
                          <Icon size={12} className={model.color === 'green' ? 'text-green-600' : 'text-amber-500'} />
                          <div className="chat-model-menu-item-content">
                            <span className={model.color === 'green' ? 'text-green-700 dark:text-green-500' : 'text-amber-600 dark:text-amber-400'}>
                              {model.label}
                            </span>
                            <span className="chat-model-menu-item-desc">{model.description}</span>
                          </div>
                          {selectedModel === model.value && (
                            <div className={`chat-model-dot ${model.color === 'green' ? 'bg-green-600' : 'bg-amber-500'}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {isProcessing ? (
                <button
                  onClick={onCancel}
                  className="chat-send-btn chat-send-btn-cancel"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!value.trim() || disabled}
                  className="cowork-go-btn"
                >
                  <span>Let's go</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
