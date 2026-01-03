// goal: UserScripts dynamic registration using chrome.userScripts API (Chrome 120+)
// eff: True document_start MAIN world injection with dynamic code support
// NOTE: This runs in background context, requires "userScripts" permission

import type { UserScript, UserScriptState } from './types';

const LOG_TAG = '[HALO:UserScripts:Registry]';
const STORAGE_KEY = 'halo_userscripts';
const SCRIPT_ID_PREFIX = 'halo-userscript-';

// Check if userScripts API is available
function isUserScriptsAvailable(): boolean {
	return typeof chrome.userScripts !== 'undefined';
}

// Convert UserScript matches to valid Chrome patterns
function normalizePattern(pattern: string): string {
	if (pattern === '*' || pattern === '*/*') return '*://*/*';
	if (pattern.startsWith('*://') || pattern.startsWith('http://') || pattern.startsWith('https://')) {
		return pattern;
	}
	// Add protocol wildcard if missing
	if (pattern.includes('/')) return `*://${pattern}`;
	return `*://${pattern}/*`;
}

// Convert user patterns to valid match patterns
function toMatchPatterns(patterns: string[]): string[] {
	const result: string[] = [];
	for (const p of patterns) {
		try {
			const normalized = normalizePattern(p.trim());
			if (normalized && normalized.includes('://')) {
				result.push(normalized);
			}
		} catch {
			console.warn(LOG_TAG, `Invalid pattern: ${p}`);
		}
	}
	return result.length > 0 ? result : ['*://*/*'];
}

// Wrap user script code for MAIN world injection
function wrapForMainWorld(code: string, name: string, type: 'javascript' | 'css'): string {
	const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

	if (type === 'css') {
		const escapedCode = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
		return `
(function() {
	try {
		const style = document.createElement('style');
		style.textContent = \`${escapedCode}\`;
		style.setAttribute('data-halo-script', '${escapedName}');
		(document.head || document.documentElement).appendChild(style);
		console.log('[HALO Script] ${escapedName} CSS injected');
	} catch(e) { console.error('[HALO Script] ${escapedName} CSS failed:', e); }
})();`;
	}

	// For JavaScript: inject via <script> tag to get true MAIN world execution
	const escapedCode = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${');
	return `
(function() {
	try {
		const s = document.createElement('script');
		s.textContent = \`${escapedCode}\`;
		const t = document.head || document.documentElement;
		t.insertBefore(s, t.firstChild);
		s.remove();
		console.log('[HALO Script] ${escapedName} executed');
	} catch(e) { console.error('[HALO Script] ${escapedName} failed:', e); }
})();`;
}

// Convert runAt to Chrome's format
function toRunAt(runAt: string): 'document_start' | 'document_end' | 'document_idle' {
	if (runAt === 'document_start') return 'document_start';
	if (runAt === 'document_end') return 'document_end';
	return 'document_idle';
}

// Unregister all HALO userscripts
async function unregisterAllScripts(): Promise<void> {
	if (!isUserScriptsAvailable()) return;

	try {
		const registered = await chrome.userScripts.getScripts();
		const haloIds = registered
			.filter((s) => s.id.startsWith(SCRIPT_ID_PREFIX))
			.map((s) => s.id);

		if (haloIds.length > 0) {
			await chrome.userScripts.unregister({ ids: haloIds });
			console.log(LOG_TAG, `Unregistered ${haloIds.length} scripts`);
		}
	} catch (e) {
		console.warn(LOG_TAG, 'Failed to unregister scripts:', e);
	}
}

// Register all enabled userscripts
async function registerAllScripts(scripts: UserScript[], globalEnabled: boolean): Promise<void> {
	if (!isUserScriptsAvailable()) {
		console.warn(LOG_TAG, 'userScripts API not available (Chrome 120+ required)');
		return;
	}

	if (!globalEnabled) {
		console.log(LOG_TAG, 'Global disabled, skipping registration');
		return;
	}

	const toRegister: chrome.userScripts.RegisteredUserScript[] = [];

	for (const script of scripts) {
		if (!script.enabled) continue;

		try {
			const matches = toMatchPatterns(script.matches);
			const excludeMatches = script.excludeMatches?.length
				? toMatchPatterns(script.excludeMatches)
				: undefined;
			const wrappedCode = wrapForMainWorld(script.code, script.name, script.type);

			toRegister.push({
				id: `${SCRIPT_ID_PREFIX}${script.id}`,
				matches,
				excludeMatches,
				js: [{ code: wrappedCode }],
				runAt: toRunAt(script.runAt),
				allFrames: false,
				world: 'MAIN',
			});
		} catch (e) {
			console.warn(LOG_TAG, `Failed to prepare ${script.name}:`, e);
		}
	}

	if (toRegister.length > 0) {
		try {
			await chrome.userScripts.register(toRegister);
			console.log(LOG_TAG, `Registered ${toRegister.length} scripts:`, toRegister.map((s) => s.id));
		} catch (e) {
			console.warn(LOG_TAG, 'Batch register failed, trying one by one:', e);
			// Try registering one by one to identify problematic scripts
			for (const script of toRegister) {
				try {
					await chrome.userScripts.register([script]);
					console.log(LOG_TAG, `Registered: ${script.id}`);
				} catch (innerE) {
					console.error(LOG_TAG, `Failed to register ${script.id}:`, innerE);
				}
			}
		}
	}
}

// Sync registered scripts with storage state
export async function syncRegisteredScripts(): Promise<void> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	const state: UserScriptState = result[STORAGE_KEY] || { scripts: [], globalEnabled: true };

	await unregisterAllScripts();
	await registerAllScripts(state.scripts, state.globalEnabled);
}

// Initialize the registry system
export function initUserScriptsRegistry(): void {
	if (!isUserScriptsAvailable()) {
		console.warn(LOG_TAG, 'userScripts API not available - requires Chrome 120+ and Developer Mode');
		return;
	}

	console.log(LOG_TAG, 'Registry initialized');

	// Initial sync
	syncRegisteredScripts();

	// Listen for storage changes to re-sync
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && changes[STORAGE_KEY]) {
			console.log(LOG_TAG, 'Storage changed, re-syncing...');
			syncRegisteredScripts();
		}
	});
}
