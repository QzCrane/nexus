// goal: HALO storage keys and helpers for chrome.storage

import type { DarkModeConfig, DarkModeFixes } from '../modules/dark-mode';
import { DEFAULT_CONFIG, DEFAULT_FIXES } from '../modules/dark-mode';

export const STORAGE_KEYS = {
	DARK_MODE_ENABLED: 'halo_dark_mode',
	DARK_MODE_WHITELIST: 'halo_dark_whitelist',
	DARK_MODE_CONFIG: 'halo_dark_config',
	DARK_MODE_FIXES: 'halo_dark_fixes',
} as const;

// post: returns current hostname or empty string
export function getCurrentHostname(): string {
	try { return window.location.hostname; } catch { return ''; }
}

// post: checks if hostname is in whitelist
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

// post: returns full dark mode settings including config and fixes
export async function getDarkModeSettings(): Promise<{
	enabled: boolean;
	whitelist: string[];
	config: Partial<DarkModeConfig>;
	fixes: Partial<DarkModeFixes>;
}> {
	const result = await chrome.storage.sync.get([
		STORAGE_KEYS.DARK_MODE_ENABLED,
		STORAGE_KEYS.DARK_MODE_WHITELIST,
		STORAGE_KEYS.DARK_MODE_CONFIG,
		STORAGE_KEYS.DARK_MODE_FIXES,
	]);
	return {
		enabled: result[STORAGE_KEYS.DARK_MODE_ENABLED] ?? false,
		whitelist: result[STORAGE_KEYS.DARK_MODE_WHITELIST] ?? [],
		config: result[STORAGE_KEYS.DARK_MODE_CONFIG] ?? {},
		fixes: result[STORAGE_KEYS.DARK_MODE_FIXES] ?? {},
	};
}

// eff: saves dark mode config
export async function saveDarkModeConfig(config: Partial<DarkModeConfig>): Promise<void> {
	await chrome.storage.sync.set({ [STORAGE_KEYS.DARK_MODE_CONFIG]: config });
}

// eff: saves dark mode fixes
export async function saveDarkModeFixes(fixes: Partial<DarkModeFixes>): Promise<void> {
	await chrome.storage.sync.set({ [STORAGE_KEYS.DARK_MODE_FIXES]: fixes });
}
