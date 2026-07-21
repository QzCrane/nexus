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
			if (normalized?.includes('://')) {
				result.push(normalized);
			}
		} catch {
			console.warn(LOG_TAG, `Invalid pattern: ${p}`);
		}
	}
	return result.length > 0 ? result : ['*://*/*'];
}

import type { ScriptType } from './types';

// rule: escape a string for safe interpolation into a JS string literal.
// Backslash first (so we don't double-escape the escapes), then quote chars,
// then newlines (which would otherwise terminate the literal mid-source).
function escapeForJsString(s: string): string {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r');
}

// Wrap user script code for MAIN world injection
// rule: build the wrapper via string concatenation, never a template literal. The
// previous `${code}` / `${escapedName}` interpolations allowed user-controlled
// content containing ` or ${} to break out of the wrapping template literal and
// inject arbitrary code into the registered userscript (runs in MAIN world via
// chrome.userScripts.register). User JS legitimately contains template literals,
// so escaping is not viable — concatenation is the only safe option.
function wrapForMainWorld(code: string, name: string, type: ScriptType): string {
	const safeName = escapeForJsString(name);

	if (type === 'css') {
		const safeCss = escapeForJsString(code);
		return [
			'(function() {',
			'    try {',
			'        const style = document.createElement("style");',
			`        style.textContent = '${safeCss}';`,
			`        style.setAttribute("data-halo-script", '${safeName}');`,
			'        (document.head || document.documentElement).appendChild(style);',
			`        console.log("[HALO Script] ${safeName} CSS injected");`,
			`    } catch(e) { console.error("[HALO Script] ${safeName} CSS failed:", e); }`,
			'})();',
		].join('\n');
	}

	// For JavaScript: Run directly in MAIN world (API handles context)
	// We just wrap in a try-catch block for safety and logging
	return [
		'(function() {',
		'    try {',
		`        ${code}`,
		`        console.log("[HALO Script] ${safeName} executed");`,
		`    } catch(e) { console.error("[HALO Script] ${safeName} failed:", e); }`,
		'})();',
	].join('\n');
}

// Convert runAt to Chrome's format
function toRunAt(runAt: string): 'document_start' | 'document_end' | 'document_idle' {
	if (runAt === 'document_start') return 'document_start';
	if (runAt === 'document_end') return 'document_end';
	return 'document_idle';
}

// Unregister all HALO userscripts and content scripts
async function unregisterAllScripts(): Promise<void> {
	// 1. Unregister UserScripts
	if (isUserScriptsAvailable()) {
		try {
			const registered = await chrome.userScripts.getScripts();
			const haloIds = registered
				.filter((s) => s.id.startsWith(SCRIPT_ID_PREFIX))
				.map((s) => s.id);

			if (haloIds.length > 0) {
				await chrome.userScripts.unregister({ ids: haloIds });
				console.log(LOG_TAG, `Unregistered ${haloIds.length} user scripts`);
			}
		} catch (e) {
			console.warn(LOG_TAG, 'Failed to unregister user scripts:', e);
		}
	}

	// 2. Unregister Content Scripts (ISOLATED world)
	try {
		const registeredContent = await chrome.scripting.getRegisteredContentScripts();
		const haloContentIds = registeredContent
			.filter((s) => s.id.startsWith(SCRIPT_ID_PREFIX))
			.map((s) => s.id);

		if (haloContentIds.length > 0) {
			await chrome.scripting.unregisterContentScripts({ ids: haloContentIds });
			console.log(LOG_TAG, `Unregistered ${haloContentIds.length} content scripts`);
		}
	} catch (e) {
		// chrome.scripting might not be available or no permission
		console.warn(LOG_TAG, 'Failed to unregister content scripts:', e);
	}
}

// Register all enabled userscripts
async function registerAllScripts(scripts: UserScript[], globalEnabled: boolean): Promise<void> {
	if (!globalEnabled) {
		console.log(LOG_TAG, 'Global disabled, skipping registration');
		return;
	}

	const userScriptsToRegister: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScriptsToRegister: chrome.scripting.RegisteredContentScript[] = [];

	for (const script of scripts) {
		if (!script.enabled) continue;

		try {
			const matches = toMatchPatterns(script.matches);
			const excludeMatches = script.excludeMatches?.length
				? toMatchPatterns(script.excludeMatches)
				: undefined;
			const fullId = `${SCRIPT_ID_PREFIX}${script.id}`;

			// Determine World: Default to USER_SCRIPT (MAIN-like) if not specified
			// Exception: CSS is always MAIN/USER_SCRIPT logic handled by wrapper usually, 
			// but for ISOLATED world CSS should be injected via css property of scripting API if possible.
			// For now, we keep CSS logic as is (wrapped JS) for USER_SCRIPT world, or plain CSS for ISOLATED?
			// SaaT service treats CSS as 'javascript' wrapper for MAIN world.
			// If world is ISOLATED and type is CSS, we should use native CSS injection of RegisterContentScript.

			const world = script.world || 'USER_SCRIPT';

			if (world === 'ISOLATED') {
				// native Content Script register
				if (!script.filePath) {
					console.warn(LOG_TAG, `Skipping ISOLATED script ${script.id}: No file path found`);
					continue;
				}

				const contentScript: chrome.scripting.RegisteredContentScript = {
					id: fullId,
					matches,
					excludeMatches,
					runAt: toRunAt(script.runAt),
					allFrames: false,
					world: 'ISOLATED'
				};

				if (script.type === 'css') {
					contentScript.css = [script.filePath];
				} else {
					contentScript.js = [script.filePath];
				}

				contentScriptsToRegister.push(contentScript);
			} else {
				// MAIN / USER_SCRIPT world (Default)
				const wrappedCode = wrapForMainWorld(script.code, script.name, script.type);
				userScriptsToRegister.push({
					id: fullId,
					matches,
					excludeMatches,
					js: [{ code: wrappedCode }],
					runAt: toRunAt(script.runAt),
					allFrames: false,
					world: 'USER_SCRIPT',
				});
			}
		} catch (e) {
			console.warn(LOG_TAG, `Failed to prepare ${script.name}:`, e);
		}
	}

	// Register User Scripts
	if (userScriptsToRegister.length > 0 && isUserScriptsAvailable()) {
		try {
			await chrome.userScripts.register(userScriptsToRegister);
			console.log(LOG_TAG, `Registered ${userScriptsToRegister.length} user scripts`);
		} catch (e) {
			console.warn(LOG_TAG, 'Failed to register user scripts:', e);
		}
	}

	// Register Content Scripts (ISOLATED)
	if (contentScriptsToRegister.length > 0) {
		try {
			// Check permission implicitly via API availability (background usually has permission)
			if (chrome.scripting?.registerContentScripts) {
				await chrome.scripting.registerContentScripts(contentScriptsToRegister);
				console.log(LOG_TAG, `Registered ${contentScriptsToRegister.length} content scripts`);
			} else {
				console.warn(LOG_TAG, 'chrome.scripting API not available');
			}
		} catch (e) {
			console.warn(LOG_TAG, 'Failed to register content scripts:', e);
		}
	}

}

const SAAT_STORAGE_KEY = 'halo_saat_scripts';

// Sync registered scripts with storage state (UserScripts + SaaT)
export async function syncRegisteredScripts(): Promise<void> {
	const result = await chrome.storage.local.get([STORAGE_KEY, SAAT_STORAGE_KEY]);
	const userState: UserScriptState = result[STORAGE_KEY] || { scripts: [], globalEnabled: true };
	const saatState: UserScriptState = result[SAAT_STORAGE_KEY] || { scripts: [], globalEnabled: true };

	// Merge scripts from both sources
	// Note: We respect globalEnabled from UserScripts for user scripts, 
	// but SaaT scripts might have their own enable logic or follow global?
	// For now, let's assume globalEnabled affects EVERYTHING to be safe/consistent.
	const allScripts = [...userState.scripts, ...saatState.scripts];

	await unregisterAllScripts();
	await registerAllScripts(allScripts, userState.globalEnabled);
}

// Initialize the registry system
// rule: return a cleanup function and guard against double-registration, mirroring
// initUserScriptsEngine. Without the guard, repeated init (e.g. SW restart, hot
// reload) would stack N storage.onChanged listeners that each triggered a
// syncRegisteredScripts call, amplifying one storage write into N syncs.
let registryInitialized = false;
export function initUserScriptsRegistry(): () => void {
	if (registryInitialized) return () => {};
	if (!isUserScriptsAvailable()) {
		console.warn(LOG_TAG, 'userScripts API not available - requires Chrome 120+ and Developer Mode');
		return () => {};
	}
	registryInitialized = true;

	console.log(LOG_TAG, 'Registry initialized');

	// rule: swallow sync failures so the floating promise doesn't crash the SW.
	// Errors are logged via the .catch handler; syncRegisteredScripts already
	// logs internally for its sub-operations.
	// Initial sync
	syncRegisteredScripts().catch((e) => console.warn(LOG_TAG, 'sync failed', e));

	// Listen for storage changes to re-sync
	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		if (area === 'local') {
			if (changes[STORAGE_KEY] || changes[SAAT_STORAGE_KEY]) {
				console.log(LOG_TAG, 'Storage changed (User or SaaT), re-syncing...');
				syncRegisteredScripts().catch((e) => console.warn(LOG_TAG, 'sync failed', e));
			}
		}
	};
	chrome.storage.onChanged.addListener(listener);

	return () => {
		chrome.storage.onChanged.removeListener(listener);
		registryInitialized = false;
	};
}
