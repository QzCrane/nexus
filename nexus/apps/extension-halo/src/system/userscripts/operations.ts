import type { UserScript, UserScriptState } from './types';
import { getUserScriptsState, saveState } from './storage';

let opQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
	const result = opQueue.then(() => fn());
	opQueue = result.catch(() => undefined);
	return result;
}

// Add new script
export async function addUserScript(
	script: Omit<UserScript, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'runCount'>,
	explicitId?: string
): Promise<UserScript> {
	return serialized(async () => {
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
	});
}

// Update script
export async function updateUserScript(id: string, updates: Partial<UserScript>): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		const index = state.scripts.findIndex((s) => s.id === id);
		const current = state.scripts[index];
		if (current) {
			state.scripts[index] = { ...current, ...updates, updatedAt: Date.now() };
			await saveState(state);
		}
	});
}

// Delete script
export async function deleteUserScript(id: string): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		state.scripts = state.scripts.filter((s) => s.id !== id);
		await saveState(state);
	});
}

// Toggle script enabled
export async function toggleUserScript(id: string): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		const script = state.scripts.find((s) => s.id === id);
		if (script) {
			script.enabled = !script.enabled;
			script.updatedAt = Date.now();
			await saveState(state);
		}
	});
}

// Toggle global enabled
export async function toggleGlobalEnabled(): Promise<boolean> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		state.globalEnabled = !state.globalEnabled;
		await saveState(state);
		return state.globalEnabled;
	});
}

// Reorder script (move up/down)
export async function reorderScript(id: string, direction: 'up' | 'down'): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		const index = state.scripts.findIndex((s) => s.id === id);
		if (index === -1) return;

		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= state.scripts.length) return;

		const current = state.scripts[index];
		const target = state.scripts[newIndex];
		if (!current || !target) return;
		state.scripts[index] = target;
		state.scripts[newIndex] = current;

		state.scripts.forEach((s, i) => { s.order = i; });
		await saveState(state);
	});
}

// Increment run count
export async function incrementRunCount(id: string): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		const script = state.scripts.find((s) => s.id === id);
		if (script) {
			script.runCount++;
			script.lastRun = Date.now();
			await saveState(state);
		}
	});
}

// Save toolbar configuration
export async function saveToolbarConfig(config: UserScriptState['toolbarConfig']): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		state.toolbarConfig = config;
		await saveState(state);
	});
}
