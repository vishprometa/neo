import { Brain, FileSearch, Sparkles, Check, X } from 'lucide-react';
import type { SyncProgress } from '../lib/memory';

interface SyncStatusProps {
  progress: SyncProgress;
  onStop?: () => void;
}

export function SyncStatus({ progress, onStop }: SyncStatusProps) {
  const getPhaseInfo = () => {
    switch (progress.phase) {
      case 'scanning':
        return {
          icon: FileSearch,
          label: 'Scanning workspace...',
          sublabel: 'Discovering files',
          showSpinner: true,
        };
      case 'summarizing':
        return {
          icon: Sparkles,
          label: `Summarizing ${progress.current}/${progress.total}`,
          sublabel: progress.currentFile ? progress.currentFile.split('/').pop() : undefined,
          showSpinner: true,
        };
      case 'indexing':
        return {
          icon: Brain,
          label: 'Building project index...',
          sublabel: 'Creating memory overview',
          showSpinner: true,
        };
      case 'complete':
        return {
          icon: Check,
          label: `Synced ${progress.current} files`,
          sublabel: progress.total > progress.current ? `${progress.total - progress.current} unchanged` : undefined,
          showSpinner: false,
        };
    }
  };

  const phaseInfo = getPhaseInfo();
  const Icon = phaseInfo.icon;
  const progressPct = progress.phase === 'summarizing' && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : null;

  return (
    <div className={`sync-status ${progress.phase === 'complete' ? 'sync-status-complete' : ''}`}>
      {phaseInfo.showSpinner && <div className="sync-status-spinner" />}
      <Icon size={14} style={{ color: progress.phase === 'complete' ? 'hsl(var(--success, 142 76% 36%))' : 'hsl(var(--ring))' }} />
      <div className="sync-status-text">
        <span>{phaseInfo.label}</span>
        {phaseInfo.sublabel && (
          <span className="sync-status-sublabel">{phaseInfo.sublabel}</span>
        )}
      </div>
      {progressPct !== null && (
        <span className="sync-status-pct">{progressPct}%</span>
      )}
      {onStop && progress.phase !== 'complete' && (
        <button
          className="sync-status-stop"
          onClick={onStop}
          title="Stop syncing"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
