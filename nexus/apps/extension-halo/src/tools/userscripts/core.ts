// goal: UserScripts core logic - full feature parity with Tampermonkey
// eff: Storage, CRUD, reorder, import/export, header parsing

import type { UserScript, UserScriptState, ParsedHeader, ScriptExport, ScriptType, UserScriptRunAt } from './types';

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
export async function addUserScript(
	script: Omit<UserScript, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'runCount'>
): Promise<UserScript> {
	const state = await getUserScriptsState();
	const maxOrder = state.scripts.reduce((max, s) => Math.max(max, s.order), 0);
	const newScript: UserScript = {
		...script,
		id: crypto.randomUUID(),
		order: maxOrder + 1,
		runCount: 0,
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

// Reorder script (move up/down)
export async function reorderScript(id: string, direction: 'up' | 'down'): Promise<void> {
	const state = await getUserScriptsState();
	const index = state.scripts.findIndex((s) => s.id === id);
	if (index === -1) return;

	const newIndex = direction === 'up' ? index - 1 : index + 1;
	if (newIndex < 0 || newIndex >= state.scripts.length) return;

	// Swap positions
	[state.scripts[index], state.scripts[newIndex]] = [state.scripts[newIndex], state.scripts[index]];

	// Update order values
	state.scripts.forEach((s, i) => { s.order = i; });
	await saveState(state);
}

// Increment run count
export async function incrementRunCount(id: string): Promise<void> {
	const state = await getUserScriptsState();
	const script = state.scripts.find((s) => s.id === id);
	if (script) {
		script.runCount++;
		script.lastRun = Date.now();
		await saveState(state);
	}
}

// Get scripts matching a URL
export function getMatchingScripts(scripts: UserScript[], url: string): UserScript[] {
	return scripts
		.filter((s) => s.enabled && matchesUrl(s.matches, url) && !matchesUrl(s.excludeMatches || [], url))
		.sort((a, b) => a.order - b.order);
}

// URL pattern matching (simplified glob-style)
export function matchesUrl(patterns: string[], url: string): boolean {
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

// Parse Userscript header (// ==UserScript== format)
export function parseUserScriptHeader(code: string): ParsedHeader | null {
	const headerMatch = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
	if (!headerMatch) return null;

	const lines = headerMatch[1].split('\n');
	const header: ParsedHeader = {};

	for (const line of lines) {
		const match = line.match(/\/\/\s*@([\w-]+)\s+(.*)/);
		if (match) {
			const [, key, value] = match;
			const trimmedValue = value.trim();

			// Handle array fields
			if (key === 'match' || key === 'exclude' || key === 'grant') {
				if (!header[key]) header[key] = [];
				(header[key] as string[]).push(trimmedValue);
			} else {
				(header as any)[key] = trimmedValue;
			}
		}
	}

	return header;
}

// Create script from parsed header
export function createScriptFromHeader(code: string, header: ParsedHeader): Omit<UserScript, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'runCount'> {
	return {
		name: header.name || 'Untitled Script',
		description: header.description || '',
		code,
		enabled: true,
		type: 'javascript',
		matches: header.match || ['*://*/*'],
		excludeMatches: header.exclude,
		runAt: (header['run-at'] as UserScriptRunAt) || 'document_end',
		version: header.version,
		author: header.author,
		homepage: header.homepage,
		updateUrl: header.updateURL,
	};
}

// Export scripts to JSON
export function exportScripts(scripts: UserScript[]): string {
	const exportData: ScriptExport = {
		version: '1.0',
		exportedAt: Date.now(),
		scripts,
	};
	return JSON.stringify(exportData, null, 2);
}

// Import scripts from JSON
export async function importScripts(json: string): Promise<{ imported: number; skipped: number }> {
	const data = JSON.parse(json) as ScriptExport;
	if (data.version !== '1.0') throw new Error('Unsupported export version');

	const state = await getUserScriptsState();
	let imported = 0;
	let skipped = 0;

	for (const script of data.scripts) {
		// Skip if script with same name exists
		if (state.scripts.some(s => s.name === script.name)) {
			skipped++;
			continue;
		}

		const maxOrder = state.scripts.reduce((max, s) => Math.max(max, s.order), 0);
		state.scripts.push({
			...script,
			id: crypto.randomUUID(),
			order: maxOrder + 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		imported++;
	}

	await saveState(state);
	return { imported, skipped };
}

// Install script from URL
export async function installFromUrl(url: string): Promise<UserScript> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

	const code = await response.text();
	const header = parseUserScriptHeader(code);

	if (header) {
		const scriptData = createScriptFromHeader(code, header);
		scriptData.updateUrl = url;
		return await addUserScript(scriptData);
	} else {
		// No header found, create minimal script
		return await addUserScript({
			name: new URL(url).pathname.split('/').pop() || 'Imported Script',
			description: `Imported from ${url}`,
			code,
			enabled: true,
			type: 'javascript',
			matches: ['*://*/*'],
			runAt: 'document_end',
		});
	}
}

// Script templates
export const SCRIPT_TEMPLATES = {
	adblock: {
		name: 'Simple Ad Blocker',
		description: 'Removes common ad elements',
		type: 'javascript' as ScriptType,
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
		runAt: 'document_end' as UserScriptRunAt,
	},
	darkForce: {
		name: 'Force Dark Mode',
		description: 'Apply dark theme to any page',
		type: 'javascript' as ScriptType,
		code: `// Force dark mode via filter
document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
document.querySelectorAll('img, video, picture').forEach(el => {
  el.style.filter = 'invert(1) hue-rotate(180deg)';
});`,
		matches: ['*://*/*'],
		runAt: 'document_end' as UserScriptRunAt,
	},
	removeOverlay: {
		name: 'Remove Overlay/Modal',
		description: 'Remove fixed overlays and restore scroll',
		type: 'javascript' as ScriptType,
		code: `// Remove overlays and restore scroll
setInterval(() => {
  document.querySelectorAll('[style*="position: fixed"]').forEach(el => {
    if (parseInt(el.style.zIndex) > 1000) el.remove();
  });
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
}, 500);`,
		matches: ['*://*/*'],
		runAt: 'document_end' as UserScriptRunAt,
	},
	customCSS: {
		name: 'Custom CSS',
		description: 'Inject custom styles',
		type: 'css' as ScriptType,
		code: `/* Custom styles */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}`,
		matches: ['*://*/*'],
		runAt: 'document_start' as UserScriptRunAt,
	},
	blockSpace: {
		name: 'Block Space Scroll',
		description: 'Prevent spacebar from scrolling (video control works)',
		type: 'javascript' as ScriptType,
		code: `// Block space scroll + manually control video play/pause
(function() {
    if (window.__halo_space_blocker) return;
    window.__halo_space_blocker = true;

    // Find the most visible video on the page
    function findActiveVideo() {
        const videos = document.querySelectorAll('video');
        let best = null, bestArea = 0;
        for (const v of videos) {
            const rect = v.getBoundingClientRect();
            // Check if video is visible in viewport
            if (rect.width > 50 && rect.height > 50 && rect.top < window.innerHeight && rect.bottom > 0) {
                const area = rect.width * rect.height;
                if (area > bestArea) { bestArea = area; best = v; }
            }
        }
        return best;
    }

    function shouldBlock(event) {
        if (event.code !== 'Space' && event.keyCode !== 32) return false;

        // Find real active element
        let el = document.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;

        if (el) {
            const tag = el.tagName;
            // Allow typing in text fields
            if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return false;
            const role = el.getAttribute('role');
            if (role === 'textbox' || role === 'searchbox') return false;
        }
        return true;
    }

    function handleSpace(event) {
        if (!shouldBlock(event)) return;

        // Block scroll completely
        event.preventDefault();
        event.stopImmediatePropagation();

        // Only toggle video on keydown (not keyup) to avoid double-toggle
        if (event.type === 'keydown') {
            const video = findActiveVideo();
            if (video) {
                if (video.paused) video.play().catch(() => {});
                else video.pause();
            }
        }
    }

    window.addEventListener('keydown', handleSpace, true);
    window.addEventListener('keyup', handleSpace, true);
    console.log('[HALO] Space blocker v3 (manual video control)');
})();`,
		matches: ['*://*/*'],
		runAt: 'document_start' as UserScriptRunAt,
	},
};
