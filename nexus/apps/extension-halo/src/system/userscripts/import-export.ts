import type { UserScript, ScriptExport } from './types';
import { getUserScriptsState, saveState } from './storage';
import { addUserScript } from './operations';
import { parseUserScriptHeader, createScriptFromHeader } from './parser';
import { parseUserScriptsStorageValue } from './storage-schema';

let ieQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
	const result = ieQueue.then(() => fn());
	ieQueue = result.catch(() => undefined);
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function exportScripts(scripts: UserScript[]): string {
	const exportData: ScriptExport = {
		version: '1.0',
		exportedAt: Date.now(),
		scripts,
	};
	return JSON.stringify(exportData, null, 2);
}

export async function importScripts(json: string): Promise<{ imported: number; skipped: number }> {
	return serialized(async () => {
		const candidate: unknown = JSON.parse(json);
		if (!isRecord(candidate) || candidate.version !== '1.0' || !Array.isArray(candidate.scripts)) {
			throw new Error('Unsupported or malformed export');
		}
		const parsed = parseUserScriptsStorageValue({
			globalEnabled: true,
			scripts: candidate.scripts,
		});
		if (parsed.failed) throw new Error('Malformed script export');

		const state = await getUserScriptsState();
		let imported = 0;
		let skipped = 0;
		for (const script of parsed.scripts) {
			if (script.managedBy !== undefined || script.saatToolId !== undefined || script.moduleBuiltIn !== undefined) {
				skipped += 1;
				continue;
			}
			if (state.scripts.some((existing) => existing.name === script.name)) {
				skipped += 1;
				continue;
			}
			const maxOrder = state.scripts.reduce((max, existing) => Math.max(max, existing.order), 0);
			state.scripts.push({
				...script,
				matches: [...script.matches],
				...(script.excludeMatches ? { excludeMatches: [...script.excludeMatches] } : {}),
				id: crypto.randomUUID(),
				order: maxOrder + 1,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			} as UserScript);
			imported += 1;
		}
		await saveState(state);
		return { imported, skipped };
	});
}

export async function installFromUrl(inputUrl: string): Promise<UserScript> {
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
	}
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
