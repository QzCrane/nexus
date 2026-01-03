import type { UserScript, UserScriptState } from './types';
import { getUserScriptsState, saveState } from './storage';

// Add new script
export async function addUserScript(
	script: Omit<UserScript, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'runCount'>,
	explicitId?: string
): Promise<UserScript> {
	const state = await getUserScriptsState();
	const maxOrder = state.scripts.reduce((max, s) => Math.max(max, s.order), 0);
	const newScript: UserScript = {
		...script,
		id: explicitId || crypto.randomUUID(),
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

// Save toolbar configuration
export async function saveToolbarConfig(config: UserScriptState['toolbarConfig']): Promise<void> {
	const state = await getUserScriptsState();
	state.toolbarConfig = config;
	await saveState(state);
}
