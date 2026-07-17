import type { UserScript, ScriptExport } from './types';
import { getUserScriptsState, saveState } from './storage';
import { addUserScript } from './operations';
import { parseUserScriptHeader, createScriptFromHeader } from './parser';

let ieQueue: Promise<any> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
	ieQueue = ieQueue.then(() => fn(), (err) => { throw err; });
	return ieQueue;
}

// Export scripts to JSON
export function exportScripts(scripts: UserScript[]): string {
	const exportData: ScriptExport = {
		version: '1.0',
		exportedAt: Date.now(),
		scripts,
	};
	return JSON.stringify(exportData, null, 2);
}

// Import scripts from JSON
export async function importScripts(json: string): Promise<{ imported: number; skipped: number }> {
	return serialized(async () => {
		const data = JSON.parse(json) as ScriptExport;
		if (data.version !== '1.0') throw new Error('Unsupported export version');

		const state = await getUserScriptsState();
		let imported = 0;
		let skipped = 0;

		for (const script of data.scripts) {
			if (state.scripts.some(s => s.name === script.name)) {
				skipped++;
				continue;
			}

			const maxOrder = state.scripts.reduce((max, s) => Math.max(max, s.order), 0);
			state.scripts.push({
				...script,
				id: crypto.randomUUID(),
				order: maxOrder + 1,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			imported++;
		}

		await saveState(state);
		return { imported, skipped };
	});
}

// Install script from URL
export async function installFromUrl(url: string): Promise<UserScript> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

	const code = await response.text();
	const header = parseUserScriptHeader(code);

	if (header) {
		const scriptData = createScriptFromHeader(code, header);
		scriptData.updateUrl = url;
		return await addUserScript(scriptData);
	} else {
		// No header found, create minimal script
		return await addUserScript({
			name: new URL(url).pathname.split('/').pop() || 'Imported Script',
			description: `Imported from ${url}`,
			code,
			enabled: true,
			type: 'javascript',
			matches: ['*://*/*'],
			runAt: 'document_end',
		});
	}
}
