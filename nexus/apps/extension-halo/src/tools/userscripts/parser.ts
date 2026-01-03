import type { UserScript, ParsedHeader, UserScriptRunAt } from './types';

// Parse Userscript header (// ==UserScript== format)
export function parseUserScriptHeader(code: string): ParsedHeader | null {
	const headerMatch = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
	if (!headerMatch) return null;

	const lines = headerMatch[1].split('\n');
	const header: ParsedHeader = {};

	for (const line of lines) {
		const match = line.match(/\/\/\s*@([\w-]+)\s+(.*)/);
		if (match) {
			const [, key, value] = match;
			const trimmedValue = value.trim();

			// Handle array fields
			if (key === 'match' || key === 'exclude' || key === 'grant') {
				if (!header[key]) header[key] = [];
				(header[key] as string[]).push(trimmedValue);
			} else {
				(header as any)[key] = trimmedValue;
			}
		}
	}

	return header;
}

// Create script from parsed header
export function createScriptFromHeader(code: string, header: ParsedHeader): Omit<UserScript, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'runCount'> {
	return {
		name: header.name || 'Untitled Script',
		description: header.description || '',
		code,
		enabled: true,
		type: 'javascript',
		matches: header.match || ['*://*/*'],
		excludeMatches: header.exclude,
		runAt: (header['run-at'] as UserScriptRunAt) || 'document_end',
		version: header.version,
		author: header.author,
		homepage: header.homepage,
		updateUrl: header.updateURL,
	};
}
