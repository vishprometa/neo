/**
 * Safe localStorage wrapper that handles QuotaExceededError gracefully.
 * When quota is exceeded, it prunes the stored data and retries.
 */

/** Try to setItem, returning true on success. */
function trySet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      return false;
    }
    throw e;
  }
}

/**
 * Safely write a JSON-serializable array to localStorage.
 * On QuotaExceededError, trims the array from the front (oldest entries)
 * and retries up to `maxRetries` times, halving each time.
 * Returns true if the write succeeded.
 */
export function safeSetJSON<T>(key: string, data: T[], maxRetries = 3): boolean {
  const json = JSON.stringify(data);
  if (trySet(key, json)) return true;

  // Quota exceeded — progressively trim older entries
  let trimmed = data;
  for (let i = 0; i < maxRetries; i++) {
    const half = Math.ceil(trimmed.length / 2);
    trimmed = trimmed.slice(half);
    const trimmedJson = JSON.stringify(trimmed);
    if (trySet(key, trimmedJson)) {
      console.warn(
        `[storage] Quota exceeded for "${key}", trimmed to ${trimmed.length} entries`
      );
      return true;
    }
  }

  // Last resort: clear this key entirely
  console.warn(`[storage] Could not fit "${key}" in localStorage, clearing it`);
  localStorage.removeItem(key);
  return false;
}
