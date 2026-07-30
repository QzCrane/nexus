// goal: Unified Background Service Detection Logic
// eff: Single source of truth for determining which tools are active in background

import { BACKGROUND_PROFILES_MAP, type BackgroundProfile } from '../../kernel/registry/_generated';
import { TOOL_PREFS_KEY } from '../../kernel/registry/tool-registry';
import { safeStorageGet } from '../../kernel/core/safe-storage';

/**
 * Background Service Classification
 * 
 * GLOBAL: Always-on background services (when enabled)
 *   - Run regardless of panel state
 *   - Examples: clipboard, smooth-scroll, userscripts
 *   - Default: enabled (user must explicitly disable)
 * 
 * PANEL_BOUND: Only active when tool panel is open
 *   - Examples: pomodoro, timer, timestamp
 *   - Should NOT show green dot in background helper list
 *   - Default: inactive (only active when panel visible)
 */
export type BackgroundServiceType = 'global' | 'panel_bound';

/**
 * Classify a tool's background service type based on its profile
 */
export function classifyBackgroundService(toolId: string): BackgroundServiceType | null {
	const profile = BACKGROUND_PROFILES_MAP[toolId];
	if (!profile) return null;

	// panel_bound: Active only when panel is open (activeOnly === true)
	// global: Always-on background service (activeOnly === false)
	return profile.activeOnly ? 'panel_bound' : 'global';
}

/**
 * Check if a tool should be considered "active" in background
 * 
 * Logic:
 * 1. GLOBAL tools: Check enabled state in prefs, default to true
 * 2. PANEL_BOUND tools: Never active in background (return false)
 * 3. Non-background tools: Return false
 */
export async function isBackgroundServiceActive(toolId: string): Promise<boolean> {
	const serviceType = classifyBackgroundService(toolId);

	// Not a background service
	if (!serviceType) return false;

	// Panel-bound tools should never show as "active" in background list
	if (serviceType === 'panel_bound') return false;

	// Global background service: check prefs
	const local = await safeStorageGet([TOOL_PREFS_KEY], { [TOOL_PREFS_KEY]: {} }, { area: 'local' });
	const prefs = (local[TOOL_PREFS_KEY] || {}) as Record<string, { enabled?: boolean }>;

	// Default to enabled for global background tools
	return prefs[toolId]?.enabled ?? true;
}

/**
 * Get all currently active background services
 * Returns only GLOBAL services that are enabled
 */
export async function getActiveBackgroundServices(): Promise<string[]> {
	const active: string[] = [];

	const local = await safeStorageGet([TOOL_PREFS_KEY, 'halo_userscripts'], {
		[TOOL_PREFS_KEY]: {},
		halo_userscripts: { scripts: [] }
	}, { area: 'local' });

	const prefs = (local[TOOL_PREFS_KEY] || {}) as Record<string, { enabled?: boolean }>;

	// Check all background tools
	for (const toolId of Object.keys(BACKGROUND_PROFILES_MAP)) {
		const serviceType = classifyBackgroundService(toolId);

		// Only include GLOBAL services
		if (serviceType === 'global') {
			const isEnabled = prefs[toolId]?.enabled ?? true;
			if (isEnabled) {
				active.push(toolId);
			}
		}
	}

	// Add active user scripts (if global userscripts is enabled)
	const isUserscriptsEnabled = prefs.userscripts?.enabled ?? true;
	if (isUserscriptsEnabled) {
		const scriptData = local.halo_userscripts;
		if (scriptData?.scripts) {
			const scripts = scriptData.scripts as Array<{ id: string; enabled: boolean; saatToolId?: string }>;
			scripts.forEach(script => {
				if (script.enabled) {
					active.push(script.id);
					if (script.saatToolId) active.push(script.saatToolId);
				}
			});
		}
	}

	return active;
}

/**
 * Get background profile for a tool
 */
export function getBackgroundProfile(toolId: string): BackgroundProfile | undefined {
	return BACKGROUND_PROFILES_MAP[toolId];
}

/**
 * Check if a tool has content script background activity
 */
export function hasContentScriptActivity(toolId: string): boolean {
	const profile = BACKGROUND_PROFILES_MAP[toolId];
	if (!profile) return false;

	const contentScriptMechanisms = [
		'copy_listener',
		'wheel_listener',
		'mutation_observer',
		'raf_active',
		'userscript'
	];

	return contentScriptMechanisms.includes(profile.mechanism);
}
