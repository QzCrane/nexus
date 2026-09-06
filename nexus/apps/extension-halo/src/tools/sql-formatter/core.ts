// goal: SQL formatting adapter over the maintained `sql-formatter` engine (R06)
// rule: the engine owns keyword layout, casing policy and dialect grammar.
// Keyword case is preserved so quoted strings and identifiers are never
// rewritten; dialect selection and explicit error reporting stay with the tool.
// The formatter does not validate executability, permissions or table names.

import { format as formatSqlEngine } from 'sql-formatter';

/**
 * Format SQL text. The engine's errors are surfaced with the input untouched:
 * a failed format never silently returns mangled SQL.
 */
export function formatSql(sql: string, indent = '  '): string {
	const trimmed = sql.trim();
	if (!trimmed) return sql;
	try {
		return formatSqlEngine(trimmed, {
			// Standard SQL dialect; keyword case is preserved from the input.
			keywordCase: 'preserve',
			tabWidth: indent.length,
			useTabs: indent.startsWith('\t'),
			expressionWidth: 80,
		});
	} catch (e) {
		throw new Error(`SQL formatting failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Minify SQL: whitespace collapses outside string literals, so quoted text
 * keeps its exact spacing. This is domain glue, not a second formatter engine.
 */
export function minifySql(sql: string): string {
	let result = '';
	let inString = false;
	let stringChar = '';
	for (let i = 0; i < sql.length; i++) {
		const char = sql[i] ?? '';
		if (inString) {
			result += char;
			if (char === stringChar && sql[i - 1] !== '\\') inString = false;
			continue;
		}
		if (char === "'" || char === '"') {
			inString = true;
			stringChar = char;
			result += char;
			continue;
		}
		if (/\s/.test(char)) {
			let j = i;
			while (j < sql.length && /\s/.test(sql[j] ?? ' ')) j++;
			result += ' ';
			i = j - 1;
			continue;
		}
		result += char;
	}
	return result.replace(/\s*([(),])\s*/g, '$1').trim();
}

/**
 * Lexical validation: balanced quotes and parentheses outside string literals,
 * a recognizable statement head, and no stray separators. This is a syntax
 * sanity check, not a claim that the statement executes.
 */
export function validateSql(sql: string): { valid: boolean; message: string } {
	const trimmed = sql.trim();
	if (!trimmed) return { valid: false, message: 'Empty SQL' };

	const head = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'WITH', 'TRUNCATE'];
	let inString = false;
	let stringChar = '';
	let balance = 0;
	let lexical = '';
	for (const char of trimmed) {
		if (inString) {
			lexical += ' ';
			if (char === stringChar) inString = false;
			continue;
		}
		if (char === "'" || char === '"') {
			inString = true;
			stringChar = char;
			lexical += ' ';
			continue;
		}
		if (char === '(') balance++;
		if (char === ')') balance--;
		if (balance < 0) return { valid: false, message: 'Unbalanced parentheses' };
		lexical += char;
	}
	if (inString) return { valid: false, message: 'Unterminated string literal' };
	if (balance !== 0) return { valid: false, message: 'Unbalanced parentheses' };

	if (!head.some((kw) => lexical.toUpperCase().startsWith(kw))) {
		return { valid: false, message: 'Invalid SQL statement' };
	}
	if (/;\s*;/.test(lexical)) {
		return { valid: false, message: 'Statement contains empty separators' };
	}

	return { valid: true, message: 'Valid SQL' };
}
