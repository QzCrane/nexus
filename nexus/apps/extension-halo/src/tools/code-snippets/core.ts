// goal: Code Snippets domain codec and pure operations

import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { StorageQuotaPolicy } from '../../kernel/core/storage-quota';
import type { Snippet, Language, SnippetFilter } from './types';

export const CODE_SNIPPETS_STORAGE_KEY = 'halo_code_snippets';
// Source snippets receive the largest authored-data allocation while leaving
// the shared reserve and unrelated extension settings outside this domain.
export const CODE_SNIPPETS_QUOTA_POLICY: StorageQuotaPolicy = { maxAreaFraction: 0.4, maxItemAreaFraction: 0.05 };

export const LANGUAGES: { value: Language; label: string }[] = [
	{ value: 'javascript', label: 'JavaScript' }, { value: 'typescript', label: 'TypeScript' },
	{ value: 'python', label: 'Python' }, { value: 'go', label: 'Go' }, { value: 'rust', label: 'Rust' },
	{ value: 'java', label: 'Java' }, { value: 'cpp', label: 'C/C++' }, { value: 'csharp', label: 'C#' },
	{ value: 'php', label: 'PHP' }, { value: 'ruby', label: 'Ruby' }, { value: 'html', label: 'HTML' },
	{ value: 'css', label: 'CSS' }, { value: 'sql', label: 'SQL' }, { value: 'json', label: 'JSON' },
	{ value: 'yaml', label: 'YAML' }, { value: 'bash', label: 'Bash' }, { value: 'powershell', label: 'PowerShell' },
	{ value: 'markdown', label: 'Markdown' }, { value: 'plaintext', label: 'Plain Text' },
];
const LANGUAGE_IDS = new Set<Language>(LANGUAGES.map((language) => language.value));

function parseSnippets(value: unknown): Snippet[] | null {
	if (!Array.isArray(value)) return null;
	const ids = new Set<string>();
	const snippets: Snippet[] = [];
	for (const row of value) {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
		const item = row as Record<string, unknown>;
		if (typeof item.id !== 'string' || item.id.trim() === '' || ids.has(item.id)) return null;
		if (typeof item.title !== 'string' || typeof item.code !== 'string') return null;
		if (typeof item.language !== 'string' || !LANGUAGE_IDS.has(item.language as Language)) return null;
		if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) return null;
		const tags = [...new Set(item.tags as string[])];
		if (tags.length !== item.tags.length) return null;
		if (!Number.isSafeInteger(item.createdAt) || (item.createdAt as number) < 0) return null;
		if (!Number.isSafeInteger(item.updatedAt) || (item.updatedAt as number) < (item.createdAt as number)) return null;
		ids.add(item.id);
		snippets.push({ id: item.id, title: item.title, code: item.code, language: item.language as Language, tags, createdAt: item.createdAt as number, updatedAt: item.updatedAt as number });
	}
	return snippets;
}

export const codeSnippetsCodec: ToolStateCodec<Snippet[]> = {
	decode(value) {
		const candidate = Array.isArray(value)
			? value
			: typeof value === 'object' && value !== null && !Array.isArray(value)
				&& (value as Record<string, unknown>).version === 1
				? (value as Record<string, unknown>).items
				: null;
		const snippets = parseSnippets(candidate);
		return snippets ? { kind: 'valid', value: snippets } : { kind: 'invalid', reason: 'Snippet data has invalid fields, identities, tags, timestamps, language, or version.' };
	},
	encode(value) { return { version: 1, items: value }; },
};

export const snippetFilterCodec: ToolStateCodec<SnippetFilter> = {
	decode(value) {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'invalid', reason: 'Snippet filter is not a record.' };
		const filter = value as Record<string, unknown>;
		if (typeof filter.search !== 'string' || typeof filter.tag !== 'string' || typeof filter.language !== 'string'
			|| (filter.language !== 'all' && !LANGUAGE_IDS.has(filter.language as Language))) return { kind: 'invalid', reason: 'Snippet filter fields are invalid.' };
		return { kind: 'valid', value: { search: filter.search, language: filter.language as Language | 'all', tag: filter.tag } };
	},
	encode(value) { return value; },
};

export function createSnippet(data: Omit<Snippet, 'id' | 'createdAt' | 'updatedAt'>): Snippet {
	const now = Date.now();
	return { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

export function filterSnippets(snippets: Snippet[], filter: SnippetFilter): Snippet[] {
	return snippets.filter((snippet) => {
		if (filter.language !== 'all' && snippet.language !== filter.language) return false;
		if (filter.tag && !snippet.tags.includes(filter.tag)) return false;
		if (!filter.search) return true;
		const query = filter.search.toLowerCase();
		return snippet.title.toLowerCase().includes(query) || snippet.code.toLowerCase().includes(query);
	});
}

export function getAllTags(snippets: Snippet[]): string[] {
	return [...new Set(snippets.flatMap((snippet) => snippet.tags))].sort();
}

export async function copyToClipboard(text: string): Promise<void> { await navigator.clipboard.writeText(text); }

export function snippetItemBytes(items: readonly Snippet[]): number[] {
	const encoder = new TextEncoder();
	return items.map((item) => encoder.encode(JSON.stringify(item)).byteLength);
}
