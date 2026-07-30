// goal: YAML core logic - YAML/JSON conversion (minimal parser, no external deps)

import type { YamlConvertResult } from './types';

function isJson(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

// Detect if input is JSON or YAML
export function detectInputType(input: string): 'json' | 'yaml' | 'unknown' {
	const trimmed = input.trim();
	// JSON starts with { or [ 
	if (
		((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			(trimmed.startsWith('[') && trimmed.endsWith(']'))) &&
		isJson(trimmed)
	) return 'json';
	// YAML indicators: starts with key: or - or has no braces
	if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/m.test(trimmed) || trimmed.startsWith('-')) {
		return 'yaml';
	}
	return 'unknown';
}

// Simple YAML parser (handles basic cases: primitives, arrays, objects)
export function parseYaml(yaml: string): YamlConvertResult {
	try {
		const lines = yaml.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
		const result = parseLines(lines, 0, 0).value;
		return { success: true, output: JSON.stringify(result, null, 2) };
	} catch (e) {
		return { success: false, output: '', error: (e as Error).message };
	}
}

interface ParseResult {
	value: unknown;
	consumed: number;
}

function getIndent(line: string): number {
	return line.match(/^(\s*)/)?.[1]?.length || 0;
}

function parseLines(lines: string[], startIdx: number, baseIndent: number): ParseResult {
	if (startIdx >= lines.length) return { value: null, consumed: 0 };

	const firstLine = lines[startIdx];
	if (firstLine === undefined) return { value: null, consumed: 0 };
	const indent = getIndent(firstLine);
	if (indent < baseIndent) return { value: null, consumed: 0 };

	// Check if array
	if (firstLine.trim().startsWith('-')) {
		return parseArray(lines, startIdx, indent);
	}

	// Object
	return parseObject(lines, startIdx, indent);
}

function parseArray(lines: string[], startIdx: number, baseIndent: number): ParseResult {
	const arr: unknown[] = [];
	let i = startIdx;

	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;
		const indent = getIndent(line);
		if (indent < baseIndent || !line.trim().startsWith('-')) break;

		const content = line.trim().slice(1).trim();
		if (content) {
			arr.push(parseValue(content));
			i++;
		} else {
			// Nested structure
			const nested = parseLines(lines, i + 1, indent + 2);
			arr.push(nested.value);
			i += 1 + nested.consumed;
		}
	}

	return { value: arr, consumed: i - startIdx };
}

function parseObject(lines: string[], startIdx: number, baseIndent: number): ParseResult {
	const obj: Record<string, unknown> = {};
	let i = startIdx;

	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;
		const indent = getIndent(line);
		if (indent < baseIndent) break;
		if (indent > baseIndent) { i++; continue; }

		const colonIdx = line.indexOf(':');
		if (colonIdx === -1) { i++; continue; }

		const key = line.slice(indent, colonIdx).trim();
		const valueStr = line.slice(colonIdx + 1).trim();

		if (valueStr) {
			obj[key] = parseValue(valueStr);
			i++;
		} else {
			// Nested structure
			const nested = parseLines(lines, i + 1, indent + 2);
			obj[key] = nested.value;
			i += 1 + nested.consumed;
		}
	}

	return { value: obj, consumed: i - startIdx };
}

function parseValue(str: string): unknown {
	if (str === 'null' || str === '~') return null;
	if (str === 'true') return true;
	if (str === 'false') return false;
	if (/^-?\d+$/.test(str)) return parseInt(str, 10);
	if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
	if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
		return str.slice(1, -1);
	}
	return str;
}

// JSON to YAML converter
export function jsonToYaml(json: string): YamlConvertResult {
	try {
		const obj: unknown = JSON.parse(json);
		const yaml = toYamlString(obj, 0);
		return {
			success: true,
			output: yaml,
			normalizedInput: JSON.stringify(obj, null, 2),
		};
	} catch (e) {
		return { success: false, output: '', error: (e as Error).message };
	}
}

function toYamlString(value: unknown, indent: number): string {
	const prefix = '  '.repeat(indent);

	if (value === null) return 'null';
	if (typeof value === 'boolean') return String(value);
	if (typeof value === 'number') return String(value);
	if (typeof value === 'string') {
		if (/[\n\r:{}[\],&*#?|\-<>=!%@`]/.test(value) || value.trim() !== value) {
			return `"${value.replace(/"/g, '\\"')}"`;
		}
		return value;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		return value.map((item) => {
			const itemStr = toYamlString(item, indent + 1);
			if (typeof item === 'object' && item !== null) {
				return `${prefix}- \n${itemStr.split('\n').map((l) => `${prefix}  ${l.trim()}`).join('\n')}`;
			}
			return `${prefix}- ${itemStr}`;
		}).join('\n');
	}

	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return '{}';
		return entries.map(([k, v]) => {
			const valueStr = toYamlString(v, indent + 1);
			if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
				return `${prefix}${k}:\n${valueStr}`;
			}
			if (Array.isArray(v)) {
				return `${prefix}${k}:\n${valueStr}`;
			}
			return `${prefix}${k}: ${valueStr}`;
		}).join('\n');
	}

	return String(value);
}
