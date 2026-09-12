export const JSON_PATH_WORKER_PATH = 'workers/json-path.js';
export const JSON_PATH_DEADLINE_MS = 5_000;

export interface JsonPathRequest { json: string; expression: string; }
export type JsonPathResponse =
	| { ok: true; results: unknown[]; normalizedPaths: string[] }
	| { ok: false; kind: 'invalid-json' | 'invalid-query' | 'budget' | 'execution'; message: string };
