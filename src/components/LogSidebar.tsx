import { useEffect, useRef } from 'react';
import { Terminal, XCircle } from 'lucide-react';
import './LogSidebar.css';

export interface LogEntry {
    id: string;
    timestamp: number;
    level: 'info' | 'warning' | 'error' | 'success';
    message: string;
}

interface LogSidebarProps {
    isOpen: boolean;
    logs: LogEntry[];
    onClose: () => void;
}

export function LogSidebar({ isOpen, logs, onClose }: LogSidebarProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (isOpen) {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="log-sidebar">
            <div className="log-sidebar-header">
                <div className="log-sidebar-title">
                    <Terminal size={16} />
                    <span>Logs</span>
                </div>
                <button className="log-sidebar-close" onClick={onClose} title="Close logs">
                    <XCircle size={16} />
                </button>
            </div>

            <div className="log-sidebar-content">
                {logs.length === 0 ? (
                    <div className="log-sidebar-empty">
                        <Terminal size={32} style={{ opacity: 0.3 }} />
                        <p>No logs yet</p>
                    </div>
                ) : (
                    <div className="log-entries">
                        {logs.map((log) => (
                            <div key={log.id} className={`log-entry log-entry-${log.level}`}>
                                <div className="log-entry-time">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                </div>
                                <div className="log-entry-message">{log.message}</div>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
