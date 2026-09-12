// goal: Code Formatter adapter (R03 jsonc/lossless JSON, R06 sql-formatter,
// R09 CSSO; js/html formatting and minify remain glue until R07/R08 admission)
// rule: generic engines own the algorithms they are admitted for; this adapter
// owns option plumbing, failure reporting, and the input-original contract.
// Heavy engines load on demand so the panel's activation closure stays inside
// its production budget.

import type { CodeLanguage, FormatConfig } from './types';
import { parse as losslessParse, stringify as losslessStringify } from 'lossless-json';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

const CODE_LANGUAGES = new Set<CodeLanguage>(['html', 'css', 'js', 'json', 'sql', 'xml']);
export const codeLanguageCodec: ToolStateCodec<CodeLanguage> = {
	decode(value) {
		return typeof value === 'string' && CODE_LANGUAGES.has(value as CodeLanguage)
			? { kind: 'valid', value: value as CodeLanguage }
			: { kind: 'invalid', reason: 'Code formatter language is unsupported.' };
	},
	encode(value) { return value; },
};
export const codeIndentCodec: ToolStateCodec<number> = {
	decode(value) {
		return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 8
			? { kind: 'valid', value: value as number }
			: { kind: 'invalid', reason: 'Code formatter indentation must be an integer from 1 to 8.' };
	},
	encode(value) { return value; },
};

export const CODE_FORMATTER_OPERATION_CONTRACT: Record<CodeLanguage, {
	descriptionKey: `codeFormatter.boundaries.${CodeLanguage}`;
	syntaxValidation: 'strict' | 'engine-on-minify' | 'none';
}> = Object.freeze({
	json: { descriptionKey: 'codeFormatter.boundaries.json', syntaxValidation: 'strict' },
	html: { descriptionKey: 'codeFormatter.boundaries.html', syntaxValidation: 'none' },
	xml: { descriptionKey: 'codeFormatter.boundaries.xml', syntaxValidation: 'none' },
	css: { descriptionKey: 'codeFormatter.boundaries.css', syntaxValidation: 'engine-on-minify' },
	js: { descriptionKey: 'codeFormatter.boundaries.js', syntaxValidation: 'none' },
	sql: { descriptionKey: 'codeFormatter.boundaries.sql', syntaxValidation: 'engine-on-minify' },
});

function unsupportedLanguage(language: never): never {
	throw new Error(`Unsupported formatter language: ${String(language)}`);
}

// Main format function
export async function formatCode(code: string, config: FormatConfig): Promise<string> {
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
			return unsupportedLanguage(language);
	}
}

// JSON formatter through the lossless engine: numbers keep their exact digits.
function formatJson(code: string, indent: string): string {
	try {
		const parsed = losslessParse(code);
		return losslessStringify(parsed, undefined, indent.length) ?? code;
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
		const char = code[i] ?? '';
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

// SQL formatter through the sql-formatter engine, loaded on demand; errors
// surface explicitly.
async function formatSql(code: string, indent: string): Promise<string> {
	const trimmed = code.trim();
	if (!trimmed) return code;
	try {
		const { format: formatSqlEngine } = await import('sql-formatter');
		return formatSqlEngine(trimmed, {
			keywordCase: 'preserve',
			tabWidth: indent.length,
			useTabs: indent.startsWith('\t'),
			expressionWidth: 80,
		});
	} catch (e) {
		if (e instanceof Error && e.message.startsWith('SQL formatting failed:')) throw e;
		throw new Error(`SQL formatting failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

// Minify code (opposite of format)
// rule: minification never merges a line comment with the code that follows it
// and never edits the contents of a string literal. Comments are removed by a
// character scanner that tracks string/template state; whitespace collapsing
// runs only outside literals.

interface ScanState {
	inString: boolean;
	stringChar: string;
}

function stripCommentsPreservingStrings(code: string, language: CodeLanguage): string {
	let result = '';
	let i = 0;
	const state: ScanState = { inString: false, stringChar: '' };
	const lineComment = language === 'sql' ? '--' : '//';
	while (i < code.length) {
		const char = code[i] ?? '';
		const prev = code[i - 1];
		if (state.inString) {
			result += char;
			if (char === state.stringChar && prev !== '\\') state.inString = false;
			i++;
			continue;
		}
		if ((char === '"' || char === "'" || char === '`') && language !== 'sql') {
			state.inString = true;
			state.stringChar = char;
			result += char;
			i++;
			continue;
		}
		if (char === "'" && language === 'sql') {
			state.inString = true;
			state.stringChar = char;
			result += char;
			i++;
			continue;
		}
		if (code.startsWith(lineComment, i)) {
			// Drop the comment but keep the line break so the next statement
			// can never become part of the removed comment.
			while (i < code.length && code[i] !== '\n') i++;
			continue;
		}
		if (language !== 'sql' && code.startsWith('/*', i)) {
			const end = code.indexOf('*/', i + 2);
			i = end === -1 ? code.length : end + 2;
			result += ' ';
			continue;
		}
		result += char;
		i++;
	}
	return result;
}

function collapseWhitespaceOutsideStrings(code: string, language: CodeLanguage): string {
	let result = '';
	let inString = false;
	let stringChar = '';
	for (let i = 0; i < code.length; i++) {
		const char = code[i] ?? '';
		const prev = code[i - 1];
		if (inString) {
			result += char;
			if (char === stringChar && prev !== '\\') inString = false;
			continue;
		}
		if ((char === '"' || char === "'" || char === '`') && language !== 'sql') {
			inString = true;
			stringChar = char;
			result += char;
			continue;
		}
		if (char === "'" && language === 'sql') {
			inString = true;
			stringChar = char;
			result += char;
			continue;
		}
		if (/\s/.test(char)) {
			// A whitespace run outside a string becomes one space; newline runs
			// keep a newline so line-oriented syntax stays parseable.
			let j = i;
			let sawNewline = false;
			while (j < code.length && /\s/.test(code[j] ?? ' ')) {
				if (code[j] === '\n') sawNewline = true;
				j++;
			}
			result += sawNewline ? '\n' : ' ';
			i = j - 1;
			continue;
		}
		result += char;
	}
	return result;
}

export async function minifyCode(code: string, language: CodeLanguage): Promise<string> {
	switch (language) {
		case 'json':
			try {
				return losslessStringify(losslessParse(code)) ?? code;
			} catch {
				throw new Error('Invalid JSON');
			}
		case 'html':
		case 'xml':
			// Only whitespace between tags is removed; text nodes keep their
			// rendering-relevant spacing.
			return code.replace(/>\s+</g, '><').trim();
		case 'css':
			// CSSO owns CSS compression (R09); unknown syntax and raw nodes are
			// its documented pass-through behavior.
			return (await import('csso')).minify(code).css;
		case 'js':
			return collapseWhitespaceOutsideStrings(stripCommentsPreservingStrings(code, 'js'), 'js').trim();
		case 'sql':
			return collapseWhitespaceOutsideStrings(stripCommentsPreservingStrings(code, 'sql'), 'sql').trim();
		default:
			return unsupportedLanguage(language);
	}
}
