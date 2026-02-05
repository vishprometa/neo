import { X, Check } from 'lucide-react';

interface DeleteThreadDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteThreadDialog({ isOpen, onConfirm, onCancel }: DeleteThreadDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3 className="dialog-title">Delete thread</h3>
          <button onClick={onCancel} className="dialog-close">
            <X size={14} />
          </button>
        </div>
        <p className="dialog-body">
          This deletes the thread and its messages. This action cannot be undone.
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel} className="dialog-btn dialog-btn-cancel">
            Cancel
          </button>
          <button onClick={onConfirm} className="dialog-btn dialog-btn-danger">
            <Check size={12} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
