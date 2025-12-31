// goal: UserScripts core logic - storage and script management

import type { UserScript, UserScriptState } from './types';

const STORAGE_KEY = 'halo_userscripts';

// Default state
const DEFAULT_STATE: UserScriptState = {
	scripts: [],
	globalEnabled: true,
};

// Get all scripts
export async function getUserScriptsState(): Promise<UserScriptState> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] || DEFAULT_STATE;
}

// Save state
async function saveState(state: UserScriptState): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

// Add new script
export async function addUserScript(script: Omit<UserScript, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserScript> {
	const state = await getUserScriptsState();
	const newScript: UserScript = {
		...script,
		id: crypto.randomUUID(),
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	state.scripts.unshift(newScript);
	await saveState(state);
	return newScript;
}

// Update script
export async function updateUserScript(id: string, updates: Partial<UserScript>): Promise<void> {
	const state = await getUserScriptsState();
	const index = state.scripts.findIndex((s) => s.id === id);
	if (index !== -1) {
		state.scripts[index] = { ...state.scripts[index], ...updates, updatedAt: Date.now() };
		await saveState(state);
	}
}

// Delete script
export async function deleteUserScript(id: string): Promise<void> {
	const state = await getUserScriptsState();
	state.scripts = state.scripts.filter((s) => s.id !== id);
	await saveState(state);
}

// Toggle script enabled
export async function toggleUserScript(id: string): Promise<void> {
	const state = await getUserScriptsState();
	const script = state.scripts.find((s) => s.id === id);
	if (script) {
		script.enabled = !script.enabled;
		script.updatedAt = Date.now();
		await saveState(state);
	}
}

// Toggle global enabled
export async function toggleGlobalEnabled(): Promise<boolean> {
	const state = await getUserScriptsState();
	state.globalEnabled = !state.globalEnabled;
	await saveState(state);
	return state.globalEnabled;
}

// Get scripts matching a URL
export function getMatchingScripts(scripts: UserScript[], url: string): UserScript[] {
	return scripts.filter((s) => s.enabled && matchesUrl(s.matches, url));
}

// URL pattern matching (simplified glob-style)
function matchesUrl(patterns: string[], url: string): boolean {
	for (const pattern of patterns) {
		const regex = patternToRegex(pattern);
		if (regex.test(url)) return true;
	}
	return false;
}

// Convert URL pattern to regex
function patternToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
		.replace(/\*/g, '.*');                   // * becomes .*
	return new RegExp(`^${escaped}$`, 'i');
}

// Script templates
export const SCRIPT_TEMPLATES = {
	adblock: {
		name: 'Simple Ad Blocker',
		description: 'Removes common ad elements',
		code: `// Remove common ad containers
const adSelectors = [
  '[class*="ad-"]', '[class*="ads-"]', '[id*="ad-"]', '[id*="ads-"]',
  '.ad', '.ads', '.advertisement', '.banner-ad',
  'iframe[src*="ads"]', 'iframe[src*="doubleclick"]'
];
adSelectors.forEach(sel => {
  document.querySelectorAll(sel).forEach(el => el.remove());
});`,
		matches: ['*://*/*'],
		runAt: 'document_end' as const,
	},
	darkForce: {
		name: 'Force Dark Mode',
		description: 'Apply dark theme to any page',
		code: `// Force dark mode
document.documentElement.style.setProperty('--bg', '#1a1a2e', 'important');
document.documentElement.style.setProperty('--text', '#eaeaea', 'important');
document.body.style.cssText = 'background: #1a1a2e !important; color: #eaeaea !important;';
document.querySelectorAll('*').forEach(el => {
  el.style.backgroundColor = 'inherit';
  el.style.color = 'inherit';
});`,
		matches: ['*://*/*'],
		runAt: 'document_end' as const,
	},
	removeOverlay: {
		name: 'Remove Overlay/Modal',
		description: 'Remove fixed overlays and modals',
		code: `// Remove overlays
setInterval(() => {
  document.querySelectorAll('[style*="position: fixed"]').forEach(el => {
    if (el.style.zIndex > 1000) el.remove();
  });
  document.body.style.overflow = 'auto';
}, 500);`,
		matches: ['*://*/*'],
		runAt: 'document_end' as const,
	},
};
