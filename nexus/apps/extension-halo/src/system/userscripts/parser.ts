import type { UserScript, ParsedHeader, UserScriptRunAt } from './types';

// Parse Userscript header (// ==UserScript== format)
export function parseUserScriptHeader(code: string): ParsedHeader | null {
	const headerMatch = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
	if (!headerMatch) return null;

	const headerSource = headerMatch[1];
	if (headerSource === undefined) return null;
	const lines = headerSource.split('\n');
	const header: ParsedHeader = {};

	for (const line of lines) {
		const match = line.match(/\/\/\s*@([\w-]+)\s+(.*)/);
		if (match) {
			const key = match[1];
			const value = match[2];
			if (key === undefined || value === undefined) continue;
			const trimmedValue = value.trim();

			// Handle array fields
			if (key === 'match' || key === 'exclude' || key === 'grant') {
				const values = header[key];
				if (Array.isArray(values)) {
					values.push(trimmedValue);
				} else {
					header[key] = [trimmedValue];
				}
			} else {
				header[key] = trimmedValue;
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
