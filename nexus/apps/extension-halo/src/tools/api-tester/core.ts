// goal: Core logic for API testing - request execution and history

import type { RequestConfig, ResponseData, Header, SavedRequest, HttpMethod } from './types';
import type { ToolStateCodec, ToolStateDecode } from '../../kernel/core/storage-codec';
import { admitNetworkUrl, fetchWithObservableRedirects, NetworkAdmissionError } from '../../kernel/utils/ssrf-guard';
import { boundedFetchSignal, readBodyCapped, DEFAULT_FETCH_MAX_BYTES, DEFAULT_FETCH_TIMEOUT_MS } from '../../kernel/utils/fetch-budget';

export const API_CONFIG_LEGACY_KEY = 'halo_tool_state_api-tester-config';
export const API_RESPONSE_LEGACY_KEY = 'halo_tool_state_api-tester-res';
export const HISTORY_KEY = 'halo_api_history';

export interface ExecuteRequestOptions {
	/** Cancel the in-flight request when the owning surface is disposed. */
	signal?: AbortSignal;
	timeoutMs?: number;
	maxBytes?: number;
}

/** Execute HTTP request with bounded time and response bytes */
export async function executeRequest(config: RequestConfig, options: ExecuteRequestOptions = {}): Promise<ResponseData> {
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

	// rule: SSRF guard — the API tester is user-driven, but without this check a user
	// (or a pasted/imported request) could hit private network hosts, cloud metadata
	// endpoints, or loopback services that the browser context has access to. Reject
	// before fetch. Delegate to the shared ssrf-guard for full IPv4/IPv6 coverage.
	let parsedUrl: URL;
	try {
		parsedUrl = admitNetworkUrl(config.url);
	} catch (error) {
		const statusText = error instanceof NetworkAdmissionError ? error.code : 'invalid_url';
		return {
			status: 0,
			statusText,
			headers: {},
			body: error instanceof Error ? error.message : 'Invalid URL',
			time: 0,
			size: 0,
		};
	}

	const signal = boundedFetchSignal({ signal: options.signal, timeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS });
	const res = await fetchWithObservableRedirects(parsedUrl, {
		...init,
		signal,
	});
	const bytes = await readBodyCapped(res, options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES);
	const body = new TextDecoder().decode(bytes);
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
		size: bytes.byteLength,
	};
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
	return { id: crypto.randomUUID(), key: '', value: '', enabled: true };
}

/** Upgrade persisted header rows to stable identities without rewriting already-valid rows. */
export function normalizeHeaders(headers: Header[]): Header[] {
	const seen = new Set<string>();
	let changed = false;
	const normalized = headers.map((header) => {
		if (header.id && !seen.has(header.id)) {
			seen.add(header.id);
			return header;
		}

		changed = true;
		const id = crypto.randomUUID();
		seen.add(id);
		return { ...header, id };
	});
	return changed ? normalized : headers;
}

/** Default request config */
export const DEFAULT_CONFIG: RequestConfig = {
	method: 'GET',
	url: '',
	headers: [createHeader()],
	body: '',
	bodyType: 'none',
};

export interface ApiSensitiveState {
	readonly config: RequestConfig;
	readonly response: ResponseData | null;
	readonly history: SavedRequest[];
}

const METHOD_VALUES = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function parseConfig(value: unknown): RequestConfig | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!METHOD_VALUES.has(record.method as HttpMethod) || typeof record.url !== 'string' || typeof record.body !== 'string') return null;
	if (record.bodyType !== 'none' && record.bodyType !== 'json' && record.bodyType !== 'form' && record.bodyType !== 'text') return null;
	if (!Array.isArray(record.headers)) return null;
	const ids = new Set<string>(); const headers: Header[] = [];
	for (const row of record.headers) {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
		const header = row as Record<string, unknown>;
		if (typeof header.id !== 'string' || header.id.trim() === '' || ids.has(header.id)) return null;
		if (typeof header.key !== 'string' || typeof header.value !== 'string' || typeof header.enabled !== 'boolean') return null;
		ids.add(header.id); headers.push({ id: header.id, key: header.key, value: header.value, enabled: header.enabled });
	}
	return { method: record.method as HttpMethod, url: record.url, headers, body: record.body, bodyType: record.bodyType };
}

function parseResponse(value: unknown): ResponseData | null | undefined {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'object' || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.status !== 'number' || !Number.isFinite(record.status) || typeof record.statusText !== 'string' || typeof record.body !== 'string') return undefined;
	if (typeof record.time !== 'number' || !Number.isFinite(record.time) || typeof record.size !== 'number' || !Number.isFinite(record.size)) return undefined;
	if (typeof record.headers !== 'object' || record.headers === null || Array.isArray(record.headers) || Object.values(record.headers).some((entry) => typeof entry !== 'string')) return undefined;
	return { status: record.status, statusText: record.statusText, headers: record.headers as Record<string, string>, body: record.body, time: record.time, size: record.size };
}

function parseHistory(value: unknown): SavedRequest[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const history: SavedRequest[] = []; const ids = new Set<string>();
	for (const row of value) {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
		const record = row as Record<string, unknown>; const config = parseConfig(record.config);
		if (typeof record.id !== 'string' || record.id.trim() === '' || ids.has(record.id) || typeof record.name !== 'string' || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0 || !config) return null;
		ids.add(record.id); history.push({ id: record.id, name: record.name, config, createdAt: record.createdAt as number });
	}
	return history;
}

export const apiSensitiveCodec: ToolStateCodec<ApiSensitiveState> = {
	decode(value): ToolStateDecode<ApiSensitiveState> {
		if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as Record<string, unknown>).version !== 1) return { kind: 'invalid', reason: 'API vault data has an unsupported version.' };
		const raw = (value as Record<string, unknown>).value;
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'invalid', reason: 'API vault data is not a record.' };
		const state = raw as Record<string, unknown>;
		const config = parseConfig(state.config); const response = parseResponse(state.response); const history = parseHistory(state.history);
		return config && response !== undefined && history ? { kind: 'valid', value: { config, response, history } } : { kind: 'invalid', reason: 'API vault data has invalid config, response, history, or identities.' };
	},
	encode(value) { return { version: 1, value }; },
};

export function decodeLegacyApiState(values: Record<string, unknown>): ToolStateDecode<ApiSensitiveState> {
	const config = parseConfig(values[API_CONFIG_LEGACY_KEY]); const response = parseResponse(values[API_RESPONSE_LEGACY_KEY]); const history = parseHistory(values[HISTORY_KEY]);
	return config && response !== undefined && history ? { kind: 'valid', value: { config, response, history } } : { kind: 'invalid', reason: 'Existing API data is damaged and was left unchanged.' };
}
