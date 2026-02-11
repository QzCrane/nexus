// goal: wraps chrome.storage with timeout fallback to prevent hanging on storage failures
// rule: all storage operations must use this wrapper (§8)

const STORAGE_TIMEOUT = 2000; // 2s timeout per §8 spec

export interface StorageResult<T> {
  data: T | null;
  fromMemory: boolean;
}

// eff: gets storage value with timeout, returns null on failure
export function safeStorageGet<T>(key: string): Promise<StorageResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ data: null, fromMemory: true });
    }, STORAGE_TIMEOUT);

    chrome.storage.local.get(key, (result) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ data: null, fromMemory: true });
      } else {
        resolve({ data: result[key] ?? null, fromMemory: false });
      }
    });
  });
}

// eff: sets storage value with timeout, resolves false on failure
export function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, STORAGE_TIMEOUT);

    chrome.storage.local.set(items, () => {
      clearTimeout(timer);
      resolve(!chrome.runtime.lastError);
    });
  });
}

// eff: removes storage key with timeout
export function safeStorageRemove(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, STORAGE_TIMEOUT);

    chrome.storage.local.remove(key, () => {
      clearTimeout(timer);
      resolve(!chrome.runtime.lastError);
    });
  });
}
