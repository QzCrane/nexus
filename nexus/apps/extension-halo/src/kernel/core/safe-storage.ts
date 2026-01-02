// goal: Safe chrome storage wrapper with timeout for test environments
// eff: Prevents initialization hang when chrome.storage is unresponsive

const STORAGE_TIMEOUT = 2000; // 2 seconds timeout

/**
 * Wrap a promise with a timeout, returning fallback on timeout
 */
export const withStorageTimeout = <T>(
	promise: Promise<T>,
	fallback: T,
	operation = 'storage'
): Promise<T> => {
	return Promise.race([
		promise,
		new Promise<T>((resolve) =>
			setTimeout(() => {
				console.warn(`[SafeStorage] ${operation} timeout, using fallback`);
				resolve(fallback);
			}, STORAGE_TIMEOUT)
		),
	]).catch((err) => {
		console.warn(`[SafeStorage] ${operation} error:`, err);
		return fallback;
	});
};

/**
 * Safe get from chrome.storage.sync with timeout
 */
export const safeStorageGet = async <T extends Record<string, unknown>>(
	keys: string[],
	defaults: T
): Promise<T> => {
	return withStorageTimeout(
		chrome.storage.sync.get(keys) as Promise<T>,
		defaults,
		`get(${keys.join(',')})`
	);
};

/**
 * Safe set to chrome.storage.sync with timeout (fire and forget on timeout)
 */
export const safeStorageSet = async (items: Record<string, unknown>): Promise<void> => {
	return withStorageTimeout(
		chrome.storage.sync.set(items),
		undefined,
		'set'
	);
};

/**
 * Safe remove from chrome.storage.sync with timeout
 */
export const safeStorageRemove = async (keys: string[]): Promise<void> => {
	return withStorageTimeout(
		chrome.storage.sync.remove(keys),
		undefined,
		'remove'
	);
};
