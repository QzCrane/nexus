// goal: Core logic for API testing - request execution and history

import type { RequestConfig, ResponseData, Header, SavedRequest } from './types';

const HISTORY_KEY = 'halo_api_history';
const MAX_HISTORY = 20;

/** Execute HTTP request */
export async function executeRequest(config: RequestConfig): Promise<ResponseData> {
	const start = performance.now();
	const headers: Record<string, string> = {};
	config.headers.filter((h) => h.enabled && h.key).forEach((h) => { headers[h.key] = h.value; });

	// Add content-type if body present
	if (config.body && config.bodyType !== 'none') {
		if (config.bodyType === 'json') headers['Content-Type'] = 'application/json';
		else if (config.bodyType === 'form') headers['Content-Type'] = 'application/x-www-form-urlencoded';
		else headers['Content-Type'] = 'text/plain';
	}

	const init: RequestInit = {
		method: config.method,
		headers,
		body: config.method !== 'GET' && config.method !== 'HEAD' && config.body ? config.body : undefined,
	};

	const res = await fetch(config.url, init);
	const body = await res.text();
	const time = Math.round(performance.now() - start);

	// Parse response headers
	const resHeaders: Record<string, string> = {};
	res.headers.forEach((v, k) => { resHeaders[k] = v; });

	return {
		status: res.status,
		statusText: res.statusText,
		headers: resHeaders,
		body,
		time,
		size: new Blob([body]).size,
	};
}

/** Get request history */
export async function getHistory(): Promise<SavedRequest[]> {
	const result = await chrome.storage.local.get(HISTORY_KEY);
	return result[HISTORY_KEY] || [];
}

/** Save request to history */
export async function saveToHistory(name: string, config: RequestConfig): Promise<void> {
	const history = await getHistory();
	const entry: SavedRequest = {
		id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		name: name || config.url,
		config,
		createdAt: Date.now(),
	};
	history.unshift(entry);
	if (history.length > MAX_HISTORY) history.pop();
	await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

/** Delete from history */
export async function deleteFromHistory(id: string): Promise<void> {
	const history = await getHistory();
	await chrome.storage.local.set({ [HISTORY_KEY]: history.filter((h) => h.id !== id) });
}

/** Clear history */
export async function clearHistory(): Promise<void> {
	await chrome.storage.local.remove(HISTORY_KEY);
}

/** Format response body (try JSON prettify) */
export function formatBody(body: string): string {
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
}

/** Format size */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Create empty header */
export function createHeader(): Header {
	return { key: '', value: '', enabled: true };
}

/** Default request config */
export const DEFAULT_CONFIG: RequestConfig = {
	method: 'GET',
	url: '',
	headers: [createHeader()],
	body: '',
	bodyType: 'none',
};
