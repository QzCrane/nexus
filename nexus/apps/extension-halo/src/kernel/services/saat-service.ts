// goal: SaaT (Script-as-a-Tool) service - manages packaged script runtimes
// eff: Materializes install-time script descriptors with explicit runtime ownership

import type { PluginMeta } from '../core/tool-registry-types';
import type { PluginType, ScriptType } from '../registry/taxonomy';
import type { UserScriptManagedBy } from '../../system/userscripts/types';

const LOG_TAG = '[HALO:SaaT]';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
const USERSCRIPTS_STORAGE_KEY = 'halo_userscripts';
const TOOL_PREFS_KEY = 'halo_tool_prefs';

export interface SaaTPluginDescriptor {
	id: string;
	pluginType: PluginType;
	builtIn: boolean;
	script: {
		type: ScriptType;
		runAt: 'document_start' | 'document_end' | 'document_idle';
		matches: string[];
		excludeMatches?: string[];
		world?: 'ISOLATED' | 'MAIN' | 'USER_SCRIPT';
	};
}

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
	saatToolId: string;
	managedBy: UserScriptManagedBy;
	moduleBuiltIn: boolean;
}

const getScriptConfig = (plugin: SaaTPluginDescriptor) => ({
	type: plugin.script.type || 'javascript',
	matches: plugin.script.matches || ['*://*/*'],
	excludeMatches: plugin.script.excludeMatches || [],
	runAt: plugin.script.runAt || 'document_idle',
	world: plugin.script.world,
});

export async function isScriptToolEnabled(toolId: string): Promise<boolean> {
	try {
		const result = await chrome.storage.local.get(TOOL_PREFS_KEY);
		const prefs = result[TOOL_PREFS_KEY] || {};
		return prefs[toolId]?.enabled ?? true;
	} catch (e) {
		console.warn(LOG_TAG, 'Failed to check script tool state:', e);
		return false;
	}
}

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

async function resolveScript(toolId: string, type: ScriptType): Promise<{ code: string; path: string } | null> {
	const ext = type === 'css' ? 'css' : 'js';
	const paths = [
		`scripts/${toolId}/script.${ext}`,
		`tools/${toolId}/script.${ext}`,
	];
	let lastFailure: unknown = null;
	for (const candidatePath of paths) {
		try {
			const url = chrome.runtime.getURL(candidatePath);
			const response = await fetch(url);
			if (response.ok) return { code: await response.text(), path: candidatePath };
		} catch (error: unknown) {
			lastFailure = error;
		}
	}
	if (lastFailure !== null) {
		console.warn(LOG_TAG, `Failed to resolve bundled script ${toolId} from ${paths.join(', ')}`, lastFailure);
	}
	return null;
}

function ownershipChanged(
	existing: Partial<SaaTScriptState>,
	managedBy: UserScriptManagedBy,
	moduleBuiltIn: boolean,
): boolean {
	return existing.managedBy !== managedBy || existing.moduleBuiltIn !== moduleBuiltIn;
}

function applyPackagedOwnership(
	existing: SaaTScriptState,
	managedBy: UserScriptManagedBy,
	moduleBuiltIn: boolean,
): void {
	existing.managedBy = managedBy;
	existing.moduleBuiltIn = moduleBuiltIn;
}

/**
 * Sync script-capable packaged modules from the generated descriptor projection.
 * - pluginType='tool' -> halo_saat_scripts, managedBy='saat-tool'
 * - packaged script/system capabilities -> halo_userscripts, managedBy='packaged-script'
 *
 * Ownership metadata is persisted so ordinary worker wakes can enforce each
 * packaged module's own install tombstone without loading TOOL_REGISTRY.
 */
export async function syncSaaTTools(tools: readonly SaaTPluginDescriptor[]): Promise<void> {
	if (tools.length === 0) return;
	const saatTools = tools.filter((plugin) => plugin.pluginType === 'tool');
	const packagedScripts = tools.filter((plugin) => plugin.pluginType !== 'tool');

	// =========================================================
	// 1. Sync SaaT Tools (Hidden) -> halo_saat_scripts
	// =========================================================
	const resultSaaT = await chrome.storage.local.get([SAAT_STORAGE_KEY, TOOL_PREFS_KEY]);
	const saatState = resultSaaT[SAAT_STORAGE_KEY] || { scripts: [], globalEnabled: true };
	const toolPrefs = resultSaaT[TOOL_PREFS_KEY] || {};
	let saatChanged = false;

	for (const tool of saatTools) {
		const config = getScriptConfig(tool);
		const existingIdx = saatState.scripts.findIndex((script: SaaTScriptState) => script.saatToolId === tool.id);
		const isEnabled = toolPrefs[tool.id]?.enabled ?? true;
		const resolved = await resolveScript(tool.id, config.type);
		if (!resolved) throw new Error(`SaaT script not found: ${tool.id}`);
		const { code, path } = resolved;

		if (existingIdx >= 0) {
			const existing = saatState.scripts[existingIdx] as SaaTScriptState;
			if (
				existing.code !== code
				|| existing.filePath !== path
				|| existing.world !== config.world
				|| existing.enabled !== isEnabled
				|| ownershipChanged(existing, 'saat-tool', tool.builtIn)
			) {
				existing.code = code;
				existing.filePath = path;
				existing.world = config.world;
				existing.enabled = isEnabled;
				applyPackagedOwnership(existing, 'saat-tool', tool.builtIn);
				existing.updatedAt = Date.now();
				saatChanged = true;
			}
		} else {
			const timestamp = Date.now();
			const newScript: SaaTScriptState = {
				id: `saat-${tool.id}-${timestamp}`,
				name: tool.id,
				description: `SaaT: ${tool.id}`,
				code,
				enabled: isEnabled,
				type: config.type,
				matches: config.matches,
				excludeMatches: config.excludeMatches,
				runAt: config.runAt,
				world: config.world,
				filePath: path,
				order: 0,
				runCount: 0,
				createdAt: timestamp,
				updatedAt: timestamp,
				saatToolId: tool.id,
				managedBy: 'saat-tool',
				moduleBuiltIn: tool.builtIn,
			};
			saatState.scripts.push(newScript);
			saatChanged = true;
			console.log(LOG_TAG, `Registered SaaT Tool: ${tool.id}`);
		}
	}

	const preFilterCount = saatState.scripts.length;
	saatState.scripts = saatState.scripts.filter((script: SaaTScriptState) => (
		Boolean(script.saatToolId) && saatTools.some((tool) => tool.id === script.saatToolId)
	));
	if (saatState.scripts.length !== preFilterCount) saatChanged = true;
	if (saatChanged) await chrome.storage.local.set({ [SAAT_STORAGE_KEY]: saatState });

	// =========================================================
	// 2. Sync Packaged Scripts (Visible) -> halo_userscripts
	// =========================================================
	const resultUser = await chrome.storage.local.get(USERSCRIPTS_STORAGE_KEY);
	const userState = resultUser[USERSCRIPTS_STORAGE_KEY] || { scripts: [], globalEnabled: true };
	let userChanged = false;

	for (const scriptPlugin of packagedScripts) {
		const config = getScriptConfig(scriptPlugin);
		const existingIdx = userState.scripts.findIndex((script: SaaTScriptState) => script.saatToolId === scriptPlugin.id);
		const resolved = await resolveScript(scriptPlugin.id, config.type);
		if (!resolved) throw new Error(`Packaged script not found: ${scriptPlugin.id}`);
		const { code, path } = resolved;

		if (existingIdx >= 0) {
			const existing = userState.scripts[existingIdx] as SaaTScriptState;
			if (
				existing.code !== code
				|| existing.filePath !== path
				|| existing.world !== config.world
				|| ownershipChanged(existing, 'packaged-script', scriptPlugin.builtIn)
			) {
				existing.code = code;
				existing.filePath = path;
				existing.world = config.world;
				applyPackagedOwnership(existing, 'packaged-script', scriptPlugin.builtIn);
				existing.updatedAt = Date.now();
				userChanged = true;
			}
		} else {
			const timestamp = Date.now();
			const newScript: SaaTScriptState = {
				id: scriptPlugin.id,
				name: scriptPlugin.id,
				description: `Built-in: ${scriptPlugin.id}`,
				code,
				enabled: true,
				type: config.type,
				matches: config.matches,
				excludeMatches: config.excludeMatches,
				runAt: config.runAt,
				world: config.world,
				filePath: path,
				order: 0,
				runCount: 0,
				createdAt: timestamp,
				updatedAt: timestamp,
				saatToolId: scriptPlugin.id,
				managedBy: 'packaged-script',
				moduleBuiltIn: scriptPlugin.builtIn,
			};
			userState.scripts.push(newScript);
			userChanged = true;
			console.log(LOG_TAG, `Registered Packaged Script: ${scriptPlugin.id}`);
		}
	}

	const originalUserCount = userState.scripts.length;
	userState.scripts = userState.scripts.filter((script: SaaTScriptState) => {
		if (script.managedBy !== 'packaged-script' && !script.saatToolId) return true;
		if (script.managedBy === 'saat-tool') return false;
		return packagedScripts.some((packaged) => packaged.id === script.saatToolId);
	});
	if (userState.scripts.length !== originalUserCount) {
		console.log(LOG_TAG, `Cleaned up ${originalUserCount - userState.scripts.length} migrated registry-managed scripts`);
		userChanged = true;
	}
	if (userChanged) await chrome.storage.local.set({ [USERSCRIPTS_STORAGE_KEY]: userState });
}

let saatInitialized = false;
export function initSaaTService(): () => void {
	if (saatInitialized) return () => {};
	saatInitialized = true;
	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		const toolPrefsChange = changes[TOOL_PREFS_KEY];
		if (area !== 'local' || !toolPrefsChange) return;
		void (async () => {
			try {
				const newPrefs = toolPrefsChange.newValue || {};
				const result = await chrome.storage.local.get(SAAT_STORAGE_KEY);
				const state = result[SAAT_STORAGE_KEY];
				if (!state?.scripts) return;
				let changed = false;
				const scripts = state.scripts as SaaTScriptState[];
				for (const script of scripts) {
					if (!script.saatToolId) continue;
					const isEnabled = newPrefs[script.saatToolId]?.enabled ?? true;
					if (script.enabled !== isEnabled) {
						script.enabled = isEnabled;
						script.updatedAt = Date.now();
						changed = true;
					}
				}
				if (changed) await chrome.storage.local.set({ [SAAT_STORAGE_KEY]: state });
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
