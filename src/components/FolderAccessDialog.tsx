import { X, Check } from 'lucide-react';

interface FolderAccessDialogProps {
  isOpen: boolean;
  folderPath: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FolderAccessDialog({ isOpen, folderPath, onConfirm, onCancel }: FolderAccessDialogProps) {
  if (!isOpen || !folderPath) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3 className="dialog-title">Allow editing?</h3>
          <button onClick={onCancel} className="dialog-close" aria-label="Close dialog">
            <X size={14} />
          </button>
        </div>
        <p className="dialog-body">
          Neo will create and update files in this folder to index and store memory:
        </p>
        <p className="dialog-body">
          <strong>{folderPath}</strong>
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel} className="dialog-btn dialog-btn-cancel">
            Cancel
          </button>
          <button onClick={onConfirm} className="dialog-btn dialog-btn-primary">
            <Check size={12} />
            Allow editing
          </button>
        </div>
      </div>
    </div>
  );
}
