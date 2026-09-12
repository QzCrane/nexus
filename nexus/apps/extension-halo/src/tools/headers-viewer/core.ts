// goal: Headers Viewer core logic - fetch and analyze headers

import type { HeaderInfo, HeaderCategory } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { admitNetworkUrl, fetchWithObservableRedirects } from '../../kernel/utils/ssrf-guard';
import { boundedFetchSignal, DEFAULT_FETCH_TIMEOUT_MS } from '../../kernel/utils/fetch-budget';

// Security headers
const SECURITY_HEADERS = ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'x-xss-protection', 'referrer-policy', 'permissions-policy'];

// Caching headers
const CACHING_HEADERS = ['cache-control', 'expires', 'etag', 'last-modified', 'age', 'vary'];

// Categorize header
function categorizeHeader(name: string): HeaderCategory {
	const lower = name.toLowerCase();
	if (SECURITY_HEADERS.includes(lower)) return 'security';
	if (CACHING_HEADERS.includes(lower)) return 'caching';
	return 'other';
}

// Fetch headers for URL
export async function fetchHeaders(url: string, options: { signal?: AbortSignal } = {}): Promise<HeaderInfo[]> {
	// rule: SSRF guard — reject non-http(s) schemes and private/loopback hosts
	// before issuing any fetch. Without this, the tool could be pointed at
	// http://localhost/admin or file:///etc/passwd and exfiltrate response headers.
	const parsedUrl = admitNetworkUrl(url);
	const signal = boundedFetchSignal({ signal: options.signal, timeoutMs: DEFAULT_FETCH_TIMEOUT_MS });

	try {
		const response = await fetchWithObservableRedirects(parsedUrl, { method: 'HEAD', mode: 'cors', signal });
		const headers: HeaderInfo[] = [];

		response.headers.forEach((value, name) => {
			headers.push({ name, value, category: categorizeHeader(name) });
		});

		return headers.sort((a, b) => a.name.localeCompare(b.name));
	} catch (headError) {
		// Try GET if HEAD fails
		try {
			const response = await fetchWithObservableRedirects(parsedUrl, { mode: 'cors', signal });
			const headers: HeaderInfo[] = [];
			response.headers.forEach((value, name) => {
				headers.push({ name, value, category: categorizeHeader(name) });
			});
			return headers.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			throw headError;
		}
	}
}

const HEADER_CATEGORIES = new Set<HeaderCategory>(['request', 'response', 'security', 'caching', 'other']);

function parseHeaderList(value: unknown): HeaderInfo[] | null {
	if (!Array.isArray(value)) return null;
	const names = new Set<string>();
	const headers: HeaderInfo[] = [];
	for (const row of value) {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
		const header = row as Record<string, unknown>;
		if (typeof header.name !== 'string' || header.name.trim() === '' || names.has(header.name.toLowerCase())) return null;
		if (typeof header.value !== 'string' || typeof header.category !== 'string' || !HEADER_CATEGORIES.has(header.category as HeaderCategory)) return null;
		names.add(header.name.toLowerCase());
		headers.push({ name: header.name, value: header.value, category: header.category as HeaderCategory });
	}
	return headers;
}

export const headerListCodec: ToolStateCodec<HeaderInfo[]> = {
	decode(value) {
		const candidate = Array.isArray(value)
			? value
			: typeof value === 'object' && value !== null && !Array.isArray(value)
				&& (value as Record<string, unknown>).version === 1
				? (value as Record<string, unknown>).items
				: null;
		const headers = parseHeaderList(candidate);
		return headers ? { kind: 'valid', value: headers } : { kind: 'invalid', reason: 'Stored header rows have invalid names, values, categories, duplicates, or version.' };
	},
	encode(value) { return { version: 1, items: value }; },
};

// Get current tab URL
export async function getCurrentTabUrl(): Promise<string | null> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		return tab?.url || null;
	} catch {
		return null;
	}
}

// Category colors
export const CATEGORY_COLORS: Record<HeaderCategory, string> = {
	request: '#3b82f6',
	response: '#22c55e',
	security: '#ef4444',
	caching: '#f59e0b',
	other: '#6b7280',
};
