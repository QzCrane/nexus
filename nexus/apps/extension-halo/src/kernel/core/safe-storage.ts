// goal: Safe chrome storage wrapper with timeout for test environments
// eff: Prevents initialization hang when chrome.storage is unresponsive

const STORAGE_TIMEOUT = 2000; // 2 seconds per attempt
const MAX_RETRIES = 3;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wrap a promise with a timeout, returning fallback on timeout
 * Includes retry logic for robustness
 */
export const withStorageTimeout = async <T>(
	promiseFactory: () => Promise<T>,
	fallback: T,
	operation = 'storage'
): Promise<T> => {
	let lastError: any;

	for (let i = 0; i < MAX_RETRIES; i++) {
		try {
			// We must create a new promise chain each time if possible, 
			// but chrome.storage calls are usually initiated when called.
			// Passing a factory function ensures we retry a FRESH request.
			const result = await Promise.race([
				promiseFactory(),
				new Promise<T>((_, reject) =>
					setTimeout(() => reject(new Error('timeout')), STORAGE_TIMEOUT)
				)
			]);
			return result;
		} catch (err: any) {
			lastError = err;
			if (i < MAX_RETRIES - 1) {
				const delay = 500 * (i + 1); // Exponential backoff: 500, 1000, 1500
				console.warn(`[SafeStorage] ${operation} attempt ${i + 1} failed/timed out, retrying in ${delay}ms...`);
				await wait(delay);
			}
		}
	}

	console.warn(`[SafeStorage] ${operation} failed after ${MAX_RETRIES} attempts. Last error:`, lastError);
	console.warn(`[SafeStorage] Using fallback value.`);
	return fallback;
};

/**
 * Safe get from chrome.storage.sync with timeout
 */
export const safeStorageGet = async <T extends Record<string, unknown>>(
	keys: string[],
	defaults: T
): Promise<T> => {
	return withStorageTimeout(
		() => chrome.storage.sync.get(keys) as Promise<T>,
		defaults,
		`get(${keys.join(',')})`
	);
};

/**
 * Safe set to chrome.storage.sync with timeout (fire and forget on timeout)
 */
export const safeStorageSet = async (items: Record<string, unknown>): Promise<void> => {
	return withStorageTimeout(
		() => chrome.storage.sync.set(items),
		undefined,
		'set'
	);
};

/**
 * Safe remove from chrome.storage.sync with timeout
 */
export const safeStorageRemove = async (keys: string[]): Promise<void> => {
	return withStorageTimeout(
		() => chrome.storage.sync.remove(keys),
		undefined,
		'remove'
	);
};
