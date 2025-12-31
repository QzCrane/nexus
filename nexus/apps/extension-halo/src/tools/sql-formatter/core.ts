// goal: SQL Formatter core logic

const KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
	'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
	'OUTER', 'ON', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
	'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'NOT', 'IN', 'LIKE',
	'BETWEEN', 'EXISTS', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ASC', 'DESC', 'PRIMARY', 'KEY',
	'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'AUTO_INCREMENT', 'IF', 'ELSE',
];

const NEWLINE_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'UNION', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES'];

// Format SQL
export function formatSql(sql: string, indent = '  '): string {
	let formatted = sql.trim();

	// Normalize whitespace
	formatted = formatted.replace(/\s+/g, ' ');

	// Add newlines before keywords
	NEWLINE_KEYWORDS.forEach((kw) => {
		const regex = new RegExp(`\\s+(${kw})\\s+`, 'gi');
		formatted = formatted.replace(regex, `\n${kw} `);
	});

	// Uppercase keywords
	KEYWORDS.forEach((kw) => {
		const regex = new RegExp(`\\b(${kw})\\b`, 'gi');
		formatted = formatted.replace(regex, kw);
	});

	// Indent subqueries
	let depth = 0;
	const lines = formatted.split('\n');
	const indented = lines.map((line) => {
		const trimmed = line.trim();
		if (trimmed.includes(')')) depth = Math.max(0, depth - 1);
		const result = indent.repeat(depth) + trimmed;
		if (trimmed.includes('(')) depth++;
		return result;
	});

	return indented.join('\n');
}

// Minify SQL
export function minifySql(sql: string): string {
	return sql.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();
}

// Validate SQL (basic check)
export function validateSql(sql: string): { valid: boolean; message: string } {
	const trimmed = sql.trim().toUpperCase();
	if (!trimmed) return { valid: false, message: 'Empty SQL' };

	const startsWithValid = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'WITH'].some((kw) => trimmed.startsWith(kw));
	if (!startsWithValid) return { valid: false, message: 'Invalid SQL statement' };

	// Check balanced parentheses
	let balance = 0;
	for (const char of sql) {
		if (char === '(') balance++;
		if (char === ')') balance--;
		if (balance < 0) return { valid: false, message: 'Unbalanced parentheses' };
	}
	if (balance !== 0) return { valid: false, message: 'Unbalanced parentheses' };

	return { valid: true, message: 'Valid SQL' };
}
