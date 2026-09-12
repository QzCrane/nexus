// goal: RFC 9535 JSONPath evaluation with explicit admission bounds

import { evaluate, JSONPathError, JSONPathParseError } from '@swaggerexpert/jsonpath';
import type { JsonPathResponse } from './worker-contract';

export const JSON_PATH_LIMITS = Object.freeze({ inputBytes: 1_048_576, queryCharacters: 4_096, nodes: 100_000, depth: 128, results: 10_000 });

class JsonPathBudgetError extends Error {}

function assertDocumentBounds(value: unknown): void {
	const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
	let nodes = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		nodes += 1;
		if (nodes > JSON_PATH_LIMITS.nodes) throw new JsonPathBudgetError('JSON document exceeds the node limit');
		if (current.depth > JSON_PATH_LIMITS.depth) throw new JsonPathBudgetError('JSON document exceeds the nesting limit');
		if (current.value && typeof current.value === 'object') {
			for (const child of Object.values(current.value)) stack.push({ depth: current.depth + 1, value: child });
		}
	}
}

export function evaluateJsonPath(json: string, expression: string): JsonPathResponse {
	if (new TextEncoder().encode(json).byteLength > JSON_PATH_LIMITS.inputBytes) return { ok: false, kind: 'budget', message: 'JSON input exceeds the 1 MiB limit' };
	if (expression.length > JSON_PATH_LIMITS.queryCharacters) return { ok: false, kind: 'budget', message: 'JSONPath expression exceeds the 4096 character limit' };
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return { ok: false, kind: 'invalid-json', message: 'Invalid JSON' };
	}
	try {
		assertDocumentBounds(data);
		const normalizedPaths: string[] = [];
		const results = evaluate(data, expression, { callback: (_value, normalizedPath) => {
			if (normalizedPaths.length >= JSON_PATH_LIMITS.results) throw new JsonPathBudgetError('JSONPath result exceeds the 10000 match limit');
			normalizedPaths.push(normalizedPath);
		} });
		return { ok: true, results, normalizedPaths };
	} catch (error) {
		if (error instanceof JsonPathBudgetError) return { ok: false, kind: 'budget', message: error.message };
		if (error instanceof JSONPathParseError || error instanceof JSONPathError) return { ok: false, kind: 'invalid-query', message: error.message };
		throw error;
	}
}

export const EXAMPLE_PATHS = ['$.store.book[*].author', '$..author', '$.users[?@.active == true].email', '$[\'quoted.key\']', '$[-1]'];
