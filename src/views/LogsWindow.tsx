import { useEffect, useState } from 'react';
import type { LogEntry } from '../components/LogSidebar';

const LOG_STORAGE_KEY = 'neo_logs';

function loadLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function LogsWindow() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    setLogs(loadLogs());

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOG_STORAGE_KEY) {
        setLogs(loadLogs());
      }
    };

    window.addEventListener('storage', handleStorage);

    const interval = window.setInterval(() => {
      setLogs(loadLogs());
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="logs-window">
      <div className="logs-window-header">
        <span>Neo Logs</span>
      </div>
      <div className="logs-window-list">
        {logs.length === 0 ? (
          <div className="logs-window-empty">No logs yet</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`logs-window-item logs-window-${log.level}`}>
              <div className="logs-window-time">
                {new Date(log.timestamp).toLocaleTimeString()}
              </div>
              <div className="logs-window-message">{log.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
