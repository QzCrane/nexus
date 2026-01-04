// goal: SaaT (Script-as-a-Tool) service - manages script tools via userScripts API
// eff: Enables/disables script tools by syncing to userscripts storage

import type { ToolMeta } from '../core/tool-registry-types';
import { safeStorageGet, safeStorageSet } from '../core/safe-storage';
import { SaaTScriptState } from './saat-types';
import { loadScriptCode } from './saat-utils';

const LOG_TAG = '[HALO:SaaT]';
const USERSCRIPTS_STORAGE_KEY = 'halo_userscripts';

/**
 * Check if a script tool is currently enabled
 */
export async function isScriptToolEnabled(toolId: string): Promise<boolean> {
	const result = await safeStorageGet(
		[USERSCRIPTS_STORAGE_KEY],
		{ [USERSCRIPTS_STORAGE_KEY]: { scripts: [] as SaaTScriptState[], globalEnabled: true } },
		'local'
	);
	const state = result[USERSCRIPTS_STORAGE_KEY];
	const script = state.scripts.find((s: SaaTScriptState) => s.saatToolId === toolId);
	return script?.enabled ?? false;
}

/**
 * Toggle a script tool on/off
 */
export async function toggleScriptTool(tool: ToolMeta): Promise<boolean> {
	if (tool.toolType !== 'script') {
		console.warn(LOG_TAG, 'Not a script tool:', tool.id);
		return false;
	}

	const result = await safeStorageGet(
		[USERSCRIPTS_STORAGE_KEY],
		{ [USERSCRIPTS_STORAGE_KEY]: { scripts: [] as SaaTScriptState[], globalEnabled: true } },
		'local'
	);
	const state = result[USERSCRIPTS_STORAGE_KEY];
	const existingIdx = state.scripts.findIndex((s: SaaTScriptState) => s.saatToolId === tool.id);

	if (existingIdx >= 0) {
		// Toggle existing script
		state.scripts[existingIdx].enabled = !state.scripts[existingIdx].enabled;
		state.scripts[existingIdx].updatedAt = Date.now();
		console.log(LOG_TAG, `Toggled ${tool.id}:`, state.scripts[existingIdx].enabled);
	} else {
		// First time - load and register the script
		const scriptCode = await loadScriptCode(tool.id, tool.scriptType || 'javascript');
		if (!scriptCode) {
			console.error(LOG_TAG, 'Failed to load script code for:', tool.id);
			return false;
		}

		const newScript: SaaTScriptState = {
			id: `saat-${tool.id}-${Date.now()}`,
			name: tool.id,
			description: `SaaT: ${tool.id}`,
			code: scriptCode,
			enabled: true,
			type: tool.scriptType || 'javascript',
			matches: tool.scriptMatches || ['*://*/*'],
			excludeMatches: tool.scriptExcludeMatches || [],
			runAt: tool.scriptRunAt || 'document_idle',
			order: 0,
			runCount: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			saatToolId: tool.id,
		};

		state.scripts.push(newScript);
		console.log(LOG_TAG, `Registered new SaaT script:`, tool.id);
	}

	await safeStorageSet({ [USERSCRIPTS_STORAGE_KEY]: state }, 'local');
	return existingIdx >= 0 ? state.scripts[existingIdx].enabled : true;
}

/**
 * Get all SaaT script states
 */
export async function getAllScriptToolStates(): Promise<Map<string, boolean>> {
	const states = new Map<string, boolean>();
	const result = await safeStorageGet(
		[USERSCRIPTS_STORAGE_KEY],
		{ [USERSCRIPTS_STORAGE_KEY]: { scripts: [] as SaaTScriptState[], globalEnabled: true } },
		'local'
	);
	const state = result[USERSCRIPTS_STORAGE_KEY];
	for (const script of state.scripts) {
		if (script.saatToolId) {
			states.set(script.saatToolId, script.enabled && state.globalEnabled);
		}
	}
	return states;
}

/**
 * Sync SaaT tools to UserScripts engine
 */
export async function syncSaaTTools(tools: ToolMeta[]): Promise<void> {
	const saatTools = tools.filter(t => t.toolType === 'script');
	if (saatTools.length === 0) return;

	const result = await safeStorageGet(
		[USERSCRIPTS_STORAGE_KEY],
		{ [USERSCRIPTS_STORAGE_KEY]: { scripts: [] as SaaTScriptState[], globalEnabled: true } },
		'local'
	);
	const state = result[USERSCRIPTS_STORAGE_KEY];
	let changed = false;

	for (const tool of saatTools) {
		const existingIdx = state.scripts.findIndex((s: SaaTScriptState) => s.saatToolId === tool.id);

		// Always try to load script code
		const scriptCode = await loadScriptCode(tool.id, tool.scriptType || 'javascript');
		if (!scriptCode) {
			console.warn(LOG_TAG, `Skipping sync for ${tool.id}: Code not found`);
			continue;
		}

		if (existingIdx >= 0) {
			// Update code if changed
			if (state.scripts[existingIdx].code !== scriptCode) {
				state.scripts[existingIdx].code = scriptCode;
				state.scripts[existingIdx].updatedAt = Date.now();
				changed = true;
			}
		} else {
			// Register new SaaT tool
			const newScript: SaaTScriptState = {
				id: `saat-${tool.id}-${Date.now()}`,
				name: tool.id,
				description: `SaaT: ${tool.id}`,
				code: scriptCode,
				enabled: false, // Default to disabled, let user enable it
				type: tool.scriptType || 'javascript',
				matches: tool.scriptMatches || ['*://*/*'],
				excludeMatches: tool.scriptExcludeMatches || [],
				runAt: tool.scriptRunAt || 'document_idle',
				order: 0,
				runCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				saatToolId: tool.id,
			};
			state.scripts.push(newScript);
			changed = true;
			console.log(LOG_TAG, `Registered new SaaT tool: ${tool.id}`);
		}
	}

	if (changed) {
		await safeStorageSet({ [USERSCRIPTS_STORAGE_KEY]: state }, 'local');
	}
}
