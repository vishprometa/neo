import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Message } from '../lib/agent';
import { safeSetJSON } from '../lib/storage';

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export function useThreads(workspaceDir: string | null) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Editing state
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const storageKey = useMemo(
    () => (workspaceDir ? `neo_threads_${encodeURIComponent(workspaceDir)}` : null),
    [workspaceDir]
  );

  // Load threads when workspace changes
  useEffect(() => {
    if (!storageKey) return;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Thread[];
        setThreads(parsed);
        if (parsed.length > 0) {
          setActiveThreadId(parsed[0].id);
          setMessages(parsed[0].messages || []);
        }
      } catch {
        setThreads([]);
      }
    } else {
      const initialThread: Thread = {
        id: `thread_${Date.now()}`,
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      setThreads([initialThread]);
      setActiveThreadId(initialThread.id);
      setMessages([]);
    }
  }, [storageKey]);

  // Save messages to thread
  useEffect(() => {
    if (!activeThreadId || !storageKey) return;
    setThreads((prev) => {
      const updated = prev.map((thread) => {
        if (thread.id !== activeThreadId) return thread;
        return { ...thread, messages, updatedAt: Date.now() };
      });
      safeSetJSON(storageKey, updated);
      return updated;
    });
  }, [messages, activeThreadId, storageKey]);

  // Update thread title from first user message
  useEffect(() => {
    if (!activeThreadId || !storageKey) return;
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) return;
    setThreads((prev) => {
      const updated = prev.map((thread) => {
        if (thread.id !== activeThreadId) return thread;
        if (thread.title !== 'New Chat') return thread;
        return { ...thread, title: (firstUser.text || '').slice(0, 40) };
      });
      safeSetJSON(storageKey, updated);
      return updated;
    });
  }, [messages, activeThreadId, storageKey]);

  const selectThread = useCallback((threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    setActiveThreadId(threadId);
    setMessages(thread.messages || []);
  }, [threads]);

  const createThread = useCallback(() => {
    const newThread: Thread = {
      id: `thread_${Date.now()}`,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    setThreads((prev) => {
      const updated = [newThread, ...prev];
      if (storageKey) safeSetJSON(storageKey, updated);
      return updated;
    });
    setActiveThreadId(newThread.id);
    setMessages([]);
    return newThread;
  }, [storageKey]);

  const deleteThread = useCallback((threadId: string) => {
    setThreads((prev) => {
      const updated = prev.filter((t) => t.id !== threadId);
      if (storageKey) safeSetJSON(storageKey, updated);
      return updated;
    });
    if (activeThreadId === threadId) {
      const remaining = threads.filter((t) => t.id !== threadId);
      const next = remaining[0];
      if (next) {
        setActiveThreadId(next.id);
        setMessages(next.messages || []);
      } else {
        // Create new thread if none left
        const newThread: Thread = {
          id: `thread_${Date.now()}`,
          title: 'New Chat',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        };
        setThreads([newThread]);
        setActiveThreadId(newThread.id);
        setMessages([]);
      }
    }
  }, [activeThreadId, threads, storageKey]);

  const startRename = useCallback((threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    setEditingThreadId(threadId);
    setEditingThreadTitle(thread.title);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, [threads]);

  const saveRename = useCallback(() => {
    if (!editingThreadId || !storageKey) return;
    const newTitle = editingThreadTitle.trim();
    if (!newTitle) {
      setEditingThreadId(null);
      setEditingThreadTitle('');
      return;
    }
    setThreads((prev) => {
      const updated = prev.map((thread) => {
        if (thread.id !== editingThreadId) return thread;
        return { ...thread, title: newTitle, updatedAt: Date.now() };
      });
      safeSetJSON(storageKey, updated);
      return updated;
    });
    setEditingThreadId(null);
    setEditingThreadTitle('');
  }, [editingThreadId, editingThreadTitle, storageKey]);

  const cancelRename = useCallback(() => {
    setEditingThreadId(null);
    setEditingThreadTitle('');
  }, []);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  return {
    threads,
    activeThreadId,
    activeThread,
    messages,
    setMessages,
    selectThread,
    createThread,
    deleteThread,
    // Rename
    editingThreadId,
    editingThreadTitle,
    setEditingThreadTitle,
    editInputRef,
    startRename,
    saveRename,
    cancelRename,
  };
}
