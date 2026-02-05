import { useRef, useEffect, useState } from 'react';
import {
  ArrowUp,
  Square,
  ChevronDown,
  MessageSquare,
  Zap,
} from 'lucide-react';

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
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelMenuPosition, setModelMenuPosition] = useState<'top' | 'bottom'>('top');

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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelMenu]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!disabled && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
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
  const ModelIcon = currentModel.icon;

  const getPlaceholderText = () => {
    return selectedModel === 'thinking'
      ? 'Ask me anything... I\'ll think deeply about it'
      : 'Ask me anything...';
  };

  return (
    <div ref={containerRef} className="chat-input-container relative">
      <div className="chat-input-wrapper">
        <div className="chat-input-main-box">
          {/* Input Area */}
          <div className="chat-input-textarea-wrapper">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                requestAnimationFrame(() => {
                  if (textareaRef.current) {
                    autoResizeTextarea(textareaRef.current);
                  }
                });
              }}
              onKeyDown={handleKeyDown}
              placeholder={getPlaceholderText()}
              disabled={disabled}
              rows={1}
              className="chat-input-textarea"
            />
          </div>

          {/* Bottom Controls */}
          <div className="chat-input-controls">
            <div className="chat-input-controls-left">
              {/* Model Dropdown */}
              <div ref={menuRef} className="relative model-menu">
                <button
                  onClick={handleModelClick}
                  className={`chat-model-btn ${currentModel.color === 'green' ? 'chat-model-btn-green' : 'chat-model-btn-amber'}`}
                >
                  <ModelIcon size={12} />
                  <span>{currentModel.label}</span>
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
            </div>

            <div className="chat-input-controls-right">
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
                  className={`chat-send-btn ${currentModel.color === 'green' ? 'chat-send-btn-green' : 'chat-send-btn-amber'}`}
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
