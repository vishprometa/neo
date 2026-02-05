/**
 * Memory module exports for Neo semantic filesystem
 */
export {
  syncDirectory,
  loadMemoryContext,
  writeJournalEntry,
  readMemoryFile,
  searchMemory,
  listMemoryFiles,
  isMemoryInitialized,
  getSyncStatus,
  getMemoryDir,
  ensureMemoryDir,
  type FileInfo,
  type ManifestEntry,
  type Manifest,
  type SyncProgress,
  type SyncProgressCallback,
} from './service';

export {
  summarizeFile,
  summarizeFilesBatch,
  summarizeDirectory,
} from './summarizer';
