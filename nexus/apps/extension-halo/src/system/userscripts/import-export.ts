import type { UserScript, ScriptExport } from './types';
import { getUserScriptsState, saveState } from './storage';
import { addUserScript } from './operations';
import { parseUserScriptHeader, createScriptFromHeader } from './parser';

let ieQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
	const result = ieQueue.then(() => fn());
	ieQueue = result.catch(() => undefined);
	return result;
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
export async function installFromUrl(inputUrl: string): Promise<UserScript> {
	// rule: scheme validation — restrict to http(s) before fetch. Without this, a
	// user (or a pasted URL) could pass file://, data:, or chrome-extension:// URLs
	// which fetch would resolve in the extension's privileged context, leaking
	// local/packaged file contents into the imported script source.
	const parsedUrl = new URL(inputUrl);
	if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
		throw new Error('Only http(s) URLs are allowed');
	}

	const response = await fetch(inputUrl);
	if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

	const code = await response.text();
	const header = parseUserScriptHeader(code);

	if (header) {
		const scriptData = createScriptFromHeader(code, header);
		scriptData.updateUrl = inputUrl;
		return await addUserScript(scriptData);
	} else {
		// No header found, create minimal script
		return await addUserScript({
			name: parsedUrl.pathname.split('/').pop() || 'Imported Script',
			description: `Imported from ${inputUrl}`,
			code,
			enabled: true,
			type: 'javascript',
			matches: ['*://*/*'],
			runAt: 'document_end',
		});
	}
}
