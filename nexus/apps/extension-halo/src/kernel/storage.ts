// goal: HALO storage keys and helpers for chrome.storage

export const STORAGE_KEYS = {
	DARK_MODE_ENABLED: 'halo_dark_mode',
	DARK_MODE_WHITELIST: 'halo_dark_whitelist',
} as const;

export interface HaloStorage {
	[STORAGE_KEYS.DARK_MODE_ENABLED]: boolean;
	[STORAGE_KEYS.DARK_MODE_WHITELIST]: string[];
}

// post: returns current hostname or empty string
export function getCurrentHostname(): string {
	try {
		return window.location.hostname;
	} catch {
		return '';
	}
}

// post: checks if hostname is in whitelist (excluded from dark mode)
export async function isHostnameWhitelisted(hostname: string): Promise<boolean> {
	if (!hostname) return false;
	const result = await chrome.storage.sync.get([STORAGE_KEYS.DARK_MODE_WHITELIST]);
	const whitelist: string[] = result[STORAGE_KEYS.DARK_MODE_WHITELIST] ?? [];
	return whitelist.includes(hostname);
}

// eff: adds hostname to whitelist
export async function addToWhitelist(hostname: string): Promise<void> {
	if (!hostname) return;
	const result = await chrome.storage.sync.get([STORAGE_KEYS.DARK_MODE_WHITELIST]);
	const whitelist: string[] = result[STORAGE_KEYS.DARK_MODE_WHITELIST] ?? [];
	if (!whitelist.includes(hostname)) {
		whitelist.push(hostname);
		await chrome.storage.sync.set({ [STORAGE_KEYS.DARK_MODE_WHITELIST]: whitelist });
	}
}

// eff: removes hostname from whitelist
export async function removeFromWhitelist(hostname: string): Promise<void> {
	if (!hostname) return;
	const result = await chrome.storage.sync.get([STORAGE_KEYS.DARK_MODE_WHITELIST]);
	const whitelist: string[] = result[STORAGE_KEYS.DARK_MODE_WHITELIST] ?? [];
	const index = whitelist.indexOf(hostname);
	if (index > -1) {
		whitelist.splice(index, 1);
		await chrome.storage.sync.set({ [STORAGE_KEYS.DARK_MODE_WHITELIST]: whitelist });
	}
}

// post: returns full dark mode settings
export async function getDarkModeSettings(): Promise<{ enabled: boolean; whitelist: string[] }> {
	const result = await chrome.storage.sync.get([
		STORAGE_KEYS.DARK_MODE_ENABLED,
		STORAGE_KEYS.DARK_MODE_WHITELIST
	]);
	return {
		enabled: result[STORAGE_KEYS.DARK_MODE_ENABLED] ?? false,
		whitelist: result[STORAGE_KEYS.DARK_MODE_WHITELIST] ?? []
	};
}
