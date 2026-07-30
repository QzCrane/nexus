// goal: Code Formatter core logic - format various code types (no external deps)

import type { CodeLanguage, FormatConfig } from './types';

// Main format function
export function formatCode(code: string, config: FormatConfig): string {
	const { language, indentSize, useTabs } = config;
	const indent = useTabs ? '\t' : ' '.repeat(indentSize);

	switch (language) {
		case 'json':
			return formatJson(code, indent);
		case 'html':
		case 'xml':
			return formatHtml(code, indent);
		case 'css':
			return formatCss(code, indent);
		case 'js':
			return formatJs(code, indent);
		case 'sql':
			return formatSql(code, indent);
		default:
			return code;
	}
}

// JSON formatter (using native JSON)
function formatJson(code: string, indent: string): string {
	try {
		const parsed = JSON.parse(code);
		return JSON.stringify(parsed, null, indent);
	} catch {
		throw new Error('Invalid JSON');
	}
}

// HTML/XML formatter (simple indentation)
function formatHtml(code: string, indent: string): string {
	let result = '';
	let level = 0;
	const lines = code
		.replace(/>\s*</g, '>\n<')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	for (const line of lines) {
		// Decrease level for closing tags
		if (line.startsWith('</')) level = Math.max(0, level - 1);

		result += `${indent.repeat(level) + line}\n`;

		// Increase level for opening tags (not self-closing)
		if (line.match(/^<[^/!][^>]*[^/]>$/) && !line.match(/^<(br|hr|img|input|meta|link)/i)) {
			level++;
		}
	}

	return result.trim();
}

// CSS formatter
function formatCss(code: string, indent: string): string {
	let result = '';
	let level = 0;

	// Normalize
	code = code.replace(/\s+/g, ' ').replace(/\s*{\s*/g, ' {\n').replace(/\s*}\s*/g, '\n}\n');
	code = code.replace(/;\s*/g, ';\n').replace(/,\s*/g, ', ');

	const lines = code.split('\n').map((l) => l.trim()).filter(Boolean);

	for (const line of lines) {
		if (line === '}') level = Math.max(0, level - 1);
		result += `${indent.repeat(level) + line}\n`;
		if (line.endsWith('{')) level++;
	}

	return result.trim();
}

// JavaScript formatter (basic)
function formatJs(code: string, indent: string): string {
	let result = '';
	let level = 0;
	let inString = false;
	let stringChar = '';

	// Tokenize by significant characters
	const tokens: string[] = [];
	let current = '';

	for (let i = 0; i < code.length; i++) {
		const char = code[i];
		const prev = code[i - 1];

		// Track strings
		if ((char === '"' || char === "'" || char === '`') && prev !== '\\') {
			if (!inString) {
				inString = true;
				stringChar = char;
			} else if (char === stringChar) {
				inString = false;
			}
		}

		if (!inString && (char === '{' || char === '}' || char === ';')) {
			if (current.trim()) tokens.push(current.trim());
			tokens.push(char);
			current = '';
		} else {
			current += char;
		}
	}
	if (current.trim()) tokens.push(current.trim());

	// Build output
	for (const token of tokens) {
		if (token === '}') level = Math.max(0, level - 1);

		if (token === '{' || token === '}' || token === ';') {
			result = `${result.trimEnd() + token}\n`;
		} else {
			result += `${indent.repeat(level) + token} `;
		}

		if (token === '{') level++;
	}

	return result.trim();
}

// SQL formatter (basic keywords on new lines)
function formatSql(code: string, indent: string): string {
	const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES', 'LIMIT', 'OFFSET'];

	let result = code.toUpperCase();
	for (const kw of keywords) {
		result = result.replace(new RegExp(`\\b${kw}\\b`, 'gi'), `\n${kw}`);
	}

	// Indent after certain keywords
	const lines = result.split('\n').map((l) => l.trim()).filter(Boolean);
	result = '';
	let level = 0;

	for (const line of lines) {
		if (line.startsWith('FROM') || line.startsWith('WHERE') || line.startsWith('SET')) {
			level = 1;
		} else if (line.startsWith('SELECT') || line.startsWith('INSERT') || line.startsWith('UPDATE')) {
			level = 0;
		}

		const prefix = line.match(/^(AND|OR)\b/) ? indent.repeat(level + 1) : indent.repeat(level);
		result += `${prefix + line}\n`;
	}

	return result.trim();
}

// Minify code (opposite of format)
export function minifyCode(code: string, language: CodeLanguage): string {
	switch (language) {
		case 'json':
			try {
				return JSON.stringify(JSON.parse(code));
			} catch {
				return code;
			}
		case 'html':
		case 'xml':
			return code.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
		case 'css':
			return code.replace(/\s+/g, ' ').replace(/\s*{\s*/g, '{').replace(/\s*}\s*/g, '}').replace(/\s*;\s*/g, ';').replace(/\s*:\s*/g, ':').trim();
		case 'js':
			return code.replace(/\s+/g, ' ').replace(/\s*([{}();,:])\s*/g, '$1').trim();
		case 'sql':
			return code.replace(/\s+/g, ' ').trim();
		default:
			return code;
	}
}
