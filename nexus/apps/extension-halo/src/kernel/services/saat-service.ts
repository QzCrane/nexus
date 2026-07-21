// goal: SaaT (Script-as-a-Tool) service - manages script tools via userScripts API
// eff: Enables/disables script tools by syncing to userscripts storage

import type { PluginMeta } from '../core/tool-registry-types';

import type { ScriptType } from '../registry/taxonomy';

const LOG_TAG = '[HALO:SaaT]';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
const USERSCRIPTS_STORAGE_KEY = 'halo_userscripts'; // Kept for cleanup
const TOOL_PREFS_KEY = 'halo_tool_prefs';

export interface SaaTScriptState {
	id: string;
	name: string;
	description: string;
	code: string;
	enabled: boolean;
	type: ScriptType;
	matches: string[];
	excludeMatches: string[];
	runAt: 'document_start' | 'document_end' | 'document_idle';
	world?: 'ISOLATED' | 'MAIN' | 'USER_SCRIPT';
	filePath?: string;
	order: number;
	runCount: number;
	createdAt: number;
	updatedAt: number;
	// SaaT marker
	saatToolId: string;
}

// Helper: check if plugin has script capability (SaaT)
const isScriptPlugin = (p: PluginMeta): boolean => !!p.script;

// Helper: get script config with defaults
const getScriptConfig = (p: PluginMeta) => ({
	type: p.script?.type || 'javascript',
	matches: p.script?.matches || ['*://*/*'],
	excludeMatches: p.script?.excludeMatches || [],
	runAt: p.script?.runAt || 'document_idle',
	world: p.script?.world
});

/**
 * Check if a script tool is currently enabled (via Tool Prefs)
 */
export async function isScriptToolEnabled(toolId: string): Promise<boolean> {
	try {
		const result = await chrome.storage.local.get(TOOL_PREFS_KEY);
		const prefs = result[TOOL_PREFS_KEY] || {};
		return prefs[toolId]?.enabled ?? true; // Default to true if not set
	} catch (e) {
		console.warn(LOG_TAG, 'Failed to check script tool state:', e);
		return false;
	}
}

/**
 * Toggle a script tool on/off using Tool Prefs
 */
export async function toggleScriptTool(tool: PluginMeta): Promise<boolean> {
	try {
		const result = await chrome.storage.local.get(TOOL_PREFS_KEY);
		const prefs = result[TOOL_PREFS_KEY] || {};
		const current = prefs[tool.id]?.enabled ?? true;

		prefs[tool.id] = { ...prefs[tool.id], enabled: !current, lastUsed: Date.now() };
		await chrome.storage.local.set({ [TOOL_PREFS_KEY]: prefs });

		console.log(LOG_TAG, `Toggled ${tool.id} via Prefs:`, !current);
		return !current;
	} catch (e) {
		console.error(LOG_TAG, 'Failed to toggle script tool:', e);
		return false;
	}
}

/**
 * Load script code from bundled script file
 */
// Helper: Resolve script path and load code
async function resolveScript(toolId: string, type: ScriptType): Promise<{ code: string; path: string } | null> {
	const ext = type === 'css' ? 'css' : 'js';
	const paths = [
		`scripts/${toolId}/script.${ext}`,
		`tools/${toolId}/script.${ext}`
	];

	for (const p of paths) {
		try {
			const url = chrome.runtime.getURL(p);
			const response = await fetch(url);
			if (response.ok) {
				return {
					code: await response.text(),
					path: p
				};
			}
		} catch { }
	}
	return null;
}

/**
 * Sync SaaT tools and Built-in Scripts
 * - Tools (type='tool') -> SAAT_STORAGE_KEY (Hidden, managed by Tool Prefs)
 * - Scripts (type='script') -> USERSCRIPTS_STORAGE_KEY (Visible, managed by User Scripts Panel)
 */
export async function syncSaaTTools(tools: PluginMeta[]): Promise<void> {
	const allScriptPlugins = tools.filter(isScriptPlugin);
	if (allScriptPlugins.length === 0) return;

	const saatTools = allScriptPlugins.filter(p => p.pluginType === 'tool');
	const builtInScripts = allScriptPlugins.filter(p => p.pluginType !== 'tool'); // 'script' or 'system'

	try {
		// =========================================================
		// 1. Sync SaaT Tools (Hidden) -> halo_saat_scripts
		// =========================================================
		const resultSaaT = await chrome.storage.local.get([SAAT_STORAGE_KEY, TOOL_PREFS_KEY]);
		const saatState = resultSaaT[SAAT_STORAGE_KEY] || { scripts: [], globalEnabled: true };
		const toolPrefs = resultSaaT[TOOL_PREFS_KEY] || {};
		let saatChanged = false;

		// Clean up any Scripts that might have ended up here erroneously? Use logic if needed.
		// For now just upsert Tools.

		for (const tool of saatTools) {
			const config = getScriptConfig(tool);
			const existingIdx = saatState.scripts.findIndex((s: SaaTScriptState) => s.saatToolId === tool.id);
			const isEnabled = toolPrefs[tool.id]?.enabled ?? true;

			const resolved = await resolveScript(tool.id, config.type);
			if (!resolved) {
				console.warn(LOG_TAG, `Skipping SaaT sync for ${tool.id}: Script not found`);
				continue;
			}
			const { code, path } = resolved;

			if (existingIdx >= 0) {
				const existing = saatState.scripts[existingIdx];
				if (existing.code !== code || existing.filePath !== path || existing.world !== config.world || existing.enabled !== isEnabled) {
					existing.code = code;
					existing.filePath = path;
					existing.world = config.world;
					existing.enabled = isEnabled;
					existing.updatedAt = Date.now();
					saatChanged = true;
				}
			} else {
				const newScript: SaaTScriptState = {
					id: `saat-${tool.id}-${Date.now()}`,
					name: tool.id,
					description: `SaaT: ${tool.id}`,
					code: code,
					enabled: isEnabled,
					type: config.type,
					matches: config.matches,
					excludeMatches: config.excludeMatches,
					runAt: config.runAt,
					world: config.world,
					filePath: path,
					order: 0,
					runCount: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					saatToolId: tool.id,
				};
				saatState.scripts.push(newScript);
				saatChanged = true;
				console.log(LOG_TAG, `Registered SaaT Tool: ${tool.id}`);
			}
		}

		// Cleanup: Remove any script from SaaT storage that is NOT in saatTools list (e.g. if type changed to script)
		const preFilterCount = saatState.scripts.length;
		saatState.scripts = saatState.scripts.filter((s: SaaTScriptState) => {
			if (!s.saatToolId) return false; // Should not happen in SaaT storage
			return saatTools.some(t => t.id === s.saatToolId);
		});
		if (saatState.scripts.length !== preFilterCount) saatChanged = true;

		if (saatChanged) {
			await chrome.storage.local.set({ [SAAT_STORAGE_KEY]: saatState });
		}

		// =========================================================
		// 2. Sync Built-in Scripts (Visible) -> halo_userscripts
		// =========================================================
		const resultUser = await chrome.storage.local.get(USERSCRIPTS_STORAGE_KEY);
		const userState = resultUser[USERSCRIPTS_STORAGE_KEY] || { scripts: [], globalEnabled: true };
		let userChanged = false;

		for (const scriptPlugin of builtInScripts) {
			const config = getScriptConfig(scriptPlugin);
			const existingIdx = userState.scripts.findIndex((s: SaaTScriptState) => s.saatToolId === scriptPlugin.id);

			const resolved = await resolveScript(scriptPlugin.id, config.type);
			if (!resolved) {
				console.warn(LOG_TAG, `Skipping Script sync for ${scriptPlugin.id}: Script not found`);
				continue;
			}
			const { code, path } = resolved;

			if (existingIdx >= 0) {
				const existing = userState.scripts[existingIdx];
				// Note: For User Scripts, we DO NOT sync 'enabled' from prefs, as they are managed by the panel directly.
				if (existing.code !== code || existing.filePath !== path || existing.world !== config.world) {
					existing.code = code;
					existing.filePath = path;
					existing.world = config.world;
					existing.updatedAt = Date.now();
					userChanged = true;
				}
			} else {
				const newScript: SaaTScriptState = {
					id: `${scriptPlugin.id}`, // Use simple ID for built-ins to be friendly
					name: scriptPlugin.id, // Or use i18n name?
					description: `Built-in: ${scriptPlugin.id}`,
					code: code,
					enabled: true, // Default enabled for new scripts
					type: config.type,
					matches: config.matches,
					excludeMatches: config.excludeMatches,
					runAt: config.runAt,
					world: config.world,
					filePath: path,
					order: 0,
					runCount: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					saatToolId: scriptPlugin.id, // Mark as managed
				};
				userState.scripts.push(newScript);
				userChanged = true;
				console.log(LOG_TAG, `Registered Built-in Script: ${scriptPlugin.id}`);
			}
		}

		// Cleanup: Remove any script from UserScripts that has `saatToolId` but is NOT in `builtInScripts`
		// This effectively removes `llm-enhancer` (type=tool) from UserScripts if it was there.
		const originalUserCount = userState.scripts.length;
		userState.scripts = userState.scripts.filter((s: SaaTScriptState) => {
			if (!s.saatToolId) return true; // Keep user-created scripts (no saatToolId)
			return builtInScripts.some(b => b.id === s.saatToolId); // Keep only current built-in scripts
		});

		if (userState.scripts.length !== originalUserCount) {
			console.log(LOG_TAG, `Cleaned up ${originalUserCount - userState.scripts.length} migrated scripts/tools from UserScripts`);
			userChanged = true;
		}

		if (userChanged) {
			await chrome.storage.local.set({ [USERSCRIPTS_STORAGE_KEY]: userState });
		}

	} catch (e) {
		console.error(LOG_TAG, 'Failed to sync SaaT tools', e);
	}
}

/**
 * Initialize SaaT Service: Watch Tool Prefs changes to update Script states
 * rule: return a cleanup function and guard against double-registration.
 * Previously the listener was attached on every call and never removed, so
 * repeated init (e.g. SW restart, hot reload) stacked N identical listeners
 * that each wrote back to storage, amplifying one change into N writes.
 */
let saatInitialized = false;
export function initSaaTService(): () => void {
	if (saatInitialized) return () => {};
	saatInitialized = true;

	// rule: wrap the async listener body in try/catch — chrome.storage.onChanged
	// does not await the listener, so a rejection from the inner await chain would
	// surface as an unhandled promise rejection. Catch and log so one bad write
	// doesn't crash the SW.
	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		const toolPrefsChange = changes[TOOL_PREFS_KEY];
		if (area !== 'local' || !toolPrefsChange) return;
		(async () => {
			try {
				const newPrefs = toolPrefsChange.newValue || {};
				const result = await chrome.storage.local.get(SAAT_STORAGE_KEY);
				const state = result[SAAT_STORAGE_KEY];
				if (!state?.scripts) return;

				let changed = false;
				const scripts = state.scripts as SaaTScriptState[];

				for (const script of scripts) {
					if (script.saatToolId) {
						const isEnabled = newPrefs[script.saatToolId]?.enabled ?? true;
						if (script.enabled !== isEnabled) {
							script.enabled = isEnabled;
							script.updatedAt = Date.now();
							changed = true;
							console.log(LOG_TAG, `Syncing enabled state for ${script.saatToolId}: ${isEnabled}`);
						}
					}
				}

				if (changed) {
					await chrome.storage.local.set({ [SAAT_STORAGE_KEY]: state });
				}
			} catch (e) {
				console.warn(LOG_TAG, 'SaaT listener failed', e);
			}
		})();
	};

	chrome.storage.onChanged.addListener(listener);

	return () => {
		chrome.storage.onChanged.removeListener(listener);
		saatInitialized = false;
	};
}
