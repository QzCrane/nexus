// goal: Core logic for code snippets storage and management

import type { Snippet, Language, SnippetFilter } from './types';

const STORAGE_KEY = 'halo_code_snippets';

/** Generate unique ID */
export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Get all snippets from storage */
export async function getSnippets(): Promise<Snippet[]> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] || [];
}

/** Save snippets to storage */
async function saveSnippets(snippets: Snippet[]): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: snippets });
}

/** Create a new snippet */
export async function createSnippet(data: Omit<Snippet, 'id' | 'createdAt' | 'updatedAt'>): Promise<Snippet> {
	const now = Date.now();
	const snippet: Snippet = { ...data, id: generateId(), createdAt: now, updatedAt: now };
	const snippets = await getSnippets();
	snippets.unshift(snippet);
	await saveSnippets(snippets);
	return snippet;
}

/** Update an existing snippet */
export async function updateSnippet(id: string, data: Partial<Omit<Snippet, 'id' | 'createdAt'>>): Promise<Snippet | null> {
	const snippets = await getSnippets();
	const idx = snippets.findIndex((s) => s.id === id);
	if (idx === -1) return null;
	snippets[idx] = { ...snippets[idx], ...data, updatedAt: Date.now() };
	await saveSnippets(snippets);
	return snippets[idx];
}

/** Delete a snippet */
export async function deleteSnippet(id: string): Promise<boolean> {
	const snippets = await getSnippets();
	const filtered = snippets.filter((s) => s.id !== id);
	if (filtered.length === snippets.length) return false;
	await saveSnippets(filtered);
	return true;
}

/** Filter snippets based on criteria */
export function filterSnippets(snippets: Snippet[], filter: SnippetFilter): Snippet[] {
	return snippets.filter((s) => {
		// Language filter
		if (filter.language !== 'all' && s.language !== filter.language) return false;
		// Tag filter
		if (filter.tag && !s.tags.includes(filter.tag)) return false;
		// Search filter (title or code)
		if (filter.search) {
			const q = filter.search.toLowerCase();
			const match = s.title.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
			if (!match) return false;
		}
		return true;
	});
}

/** Get all unique tags from snippets */
export function getAllTags(snippets: Snippet[]): string[] {
	const tags = new Set<string>();
	snippets.forEach((s) => s.tags.forEach((t) => tags.add(t)));
	return Array.from(tags).sort();
}

/** Copy text to clipboard */
export async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}

/** Available languages for UI */
export const LANGUAGES: { value: Language; label: string }[] = [
	{ value: 'javascript', label: 'JavaScript' },
	{ value: 'typescript', label: 'TypeScript' },
	{ value: 'python', label: 'Python' },
	{ value: 'go', label: 'Go' },
	{ value: 'rust', label: 'Rust' },
	{ value: 'java', label: 'Java' },
	{ value: 'cpp', label: 'C/C++' },
	{ value: 'csharp', label: 'C#' },
	{ value: 'php', label: 'PHP' },
	{ value: 'ruby', label: 'Ruby' },
	{ value: 'html', label: 'HTML' },
	{ value: 'css', label: 'CSS' },
	{ value: 'sql', label: 'SQL' },
	{ value: 'json', label: 'JSON' },
	{ value: 'yaml', label: 'YAML' },
	{ value: 'bash', label: 'Bash' },
	{ value: 'powershell', label: 'PowerShell' },
	{ value: 'markdown', label: 'Markdown' },
	{ value: 'plaintext', label: 'Plain Text' },
];
