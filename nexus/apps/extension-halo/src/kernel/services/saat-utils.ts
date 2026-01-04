/**
 * Load script code from bundled script file
 */
export async function loadScriptCode(toolId: string, type: 'javascript' | 'css'): Promise<string | null> {
	const ext = type === 'css' ? 'css' : 'js';

	// Primary: Check scripts/ directory (new SaaT location)
	try {
		const url = chrome.runtime.getURL(`scripts/${toolId}/script.${ext}`);
		const response = await fetch(url);
		if (response.ok) return await response.text();
	} catch { }

	// Fallback: Check tools/ directory (legacy location)
	try {
		const url = chrome.runtime.getURL(`tools/${toolId}/script.${ext}`);
		const response = await fetch(url);
		if (response.ok) return await response.text();
	} catch { }

	return null;
}
