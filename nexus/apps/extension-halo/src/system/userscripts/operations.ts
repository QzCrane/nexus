import type { UserScript, UserScriptState } from './types';
import { getUserScriptsState, saveState } from './storage';

let opQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
	const result = opQueue.then(() => fn());
	opQueue = result.catch(() => undefined);
	return result;
}

function assertUserOwned(script: UserScript | undefined, action: string): asserts script is UserScript {
	if (!script) throw new Error(`User script not found for ${action}`);
	if (script.managedBy !== undefined) {
		throw new Error(`Managed script ${script.id} cannot be ${action}; use its module owner`);
	}
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
		assertUserOwned(current, 'edited');
		state.scripts[index] = { ...current, ...updates, updatedAt: Date.now() };
		await saveState(state);
	});
}

// Delete script
export async function deleteUserScript(id: string): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		assertUserOwned(state.scripts.find((script) => script.id === id), 'deleted');
		state.scripts = state.scripts.filter((s) => s.id !== id);
		await saveState(state);
	});
}

// Toggle script enabled
export async function toggleUserScript(id: string): Promise<void> {
	return serialized(async () => {
		const state = await getUserScriptsState();
		const script = state.scripts.find((s) => s.id === id);
		assertUserOwned(script, 'toggled');
		script.enabled = !script.enabled;
		script.updatedAt = Date.now();
		await saveState(state);
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
		assertUserOwned(state.scripts[index], 'reordered');

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
