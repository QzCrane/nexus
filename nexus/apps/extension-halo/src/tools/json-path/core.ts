// goal: JSONPath core logic - query JSON with path expressions

// Simple JSONPath implementation
export function queryJsonPath(data: unknown, path: string): unknown[] {
	const results: unknown[] = [];

	if (!path.startsWith('$')) return results;

	const tokens = tokenizePath(path.slice(1));
	traverse(data, tokens, 0, results);

	return results;
}

// Tokenize path
function tokenizePath(path: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let inBracket = false;

	for (const char of path) {
		if (char === '[') {
			if (current) tokens.push(current);
			current = '';
			inBracket = true;
		} else if (char === ']') {
			if (current) tokens.push(current);
			current = '';
			inBracket = false;
		} else if (char === '.' && !inBracket) {
			if (current) tokens.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	if (current) tokens.push(current);
	return tokens.filter((t) => t);
}

// Traverse JSON
function traverse(data: unknown, tokens: string[], index: number, results: unknown[]): void {
	if (index >= tokens.length) {
		results.push(data);
		return;
	}

	const token = tokens[index];
	if (token === undefined) return;

	if (token === '*') {
		// Wildcard
		if (Array.isArray(data)) {
			data.forEach((item) => {
				traverse(item, tokens, index + 1, results);
			});
		} else if (typeof data === 'object' && data !== null) {
			Object.values(data).forEach((value) => {
				traverse(value, tokens, index + 1, results);
			});
		}
	} else if (/^\d+$/.test(token)) {
		// Array index
		if (Array.isArray(data)) {
			const i = parseInt(token, 10);
			if (i < data.length) traverse(data[i], tokens, index + 1, results);
		}
	} else if (token.startsWith("'") || token.startsWith('"')) {
		// Quoted key
		const key = token.slice(1, -1);
		if (typeof data === 'object' && data !== null && key in data) {
			traverse((data as Record<string, unknown>)[key], tokens, index + 1, results);
		}
	} else {
		// Property
		if (typeof data === 'object' && data !== null && token in data) {
			traverse((data as Record<string, unknown>)[token], tokens, index + 1, results);
		}
	}
}

// Example paths
export const EXAMPLE_PATHS = [
	'$.store.book[*].author',
	'$[0].name',
	'$.users[*].email',
	'$.data.items[0]',
	'$.*',
];
