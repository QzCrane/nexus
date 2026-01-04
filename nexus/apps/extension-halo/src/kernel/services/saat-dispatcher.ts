// goal: SaaT Dispatcher - Orchestrates script tool lifecycle
// eff: Centralizes sync, activation, and resource monitoring for SaaT

import { syncSaaTTools, toggleScriptTool, getAllScriptToolStates } from './saat-service';
import { ALL_TOOLS } from '../registry/tool-registry';

class SaaTDispatcher {
	private isInitialized = false;

	/**
	 * Initialize SaaT ecosystem
	 * Syncs all registered tool scripts to the UserScripts engine
	 */
	async initialize() {
		if (this.isInitialized) return;
		console.log('[HALO:SaaT] Initializing SaaT Dispatcher...');

		// Initial sync of all registered SaaT tools
		await syncSaaTTools(ALL_TOOLS);

		this.isInitialized = true;
	}

	/**
	 * Toggle a SaaT tool by ID
	 */
	async toggle(toolId: string): Promise<boolean> {
		const tool = ALL_TOOLS.find(t => t.id === toolId);
		if (!tool || tool.toolType !== 'script') {
			console.warn('[HALO:SaaT] Cannot toggle: Not a script tool', toolId);
			return false;
		}
		return await toggleScriptTool(tool);
	}

	/**
	 * Get current enabled status of a SaaT tool
	 */
	async getStatus(toolId: string): Promise<boolean> {
		const states = await getAllScriptToolStates();
		return states.get(toolId) || false;
	}
}

export const saatDispatcher = new SaaTDispatcher();
