// goal: JSON formatting and validation adapter (R03 jsonc-parser, R04 lossless-json)
// rule: the engines own tokenizing, text edits and number fidelity; this
// adapter owns the tool contract: strict JSON acceptance, null-prototype
// objects so a '__proto__' own key is data and survives sorting, and exact
// number spelling recovered from the source text through LosslessNumber.

import { LosslessNumber, stringify as losslessStringify } from 'lossless-json';
import { applyEdits, format as formatJsonText, parseTree, type Node as JsonNode, type ParseError } from 'jsonc-parser';
import type { FormatOptions } from './types';
import { DEFAULT_OPTIONS, STORAGE_KEY } from './types';

export interface FormatResult {
	success: boolean;
	output: string;
	error?: string;
}

function jsoncErrorText(error: number | undefined): string {
	// jsonc-parser encodes diagnostic ids as numbers; the number itself plus a
	// stable prefix is honest without hardcoding private message tables.
	return `diagnostic ${error ?? 'unknown'}`;
}

function parseStrictTree(input: string): { tree?: JsonNode; error?: string } {
	const errors: ParseError[] = [];
	const tree = parseTree(input, errors, { allowTrailingComma: false, disallowComments: true });
	if (errors.length > 0) {
		const first = errors[0];
		return { error: `Invalid JSON (offset ${first?.offset ?? 0}): ${jsoncErrorText(first?.error)}` };
	}
	if (tree === undefined) return { error: 'Invalid JSON' };
	return { tree };
}

/**
 * Rebuild the parsed tree with the tool's policies: null-prototype objects
 * (so '__proto__' is an own data key, never a prototype write) and numbers
 * carrying their exact source spelling.
 */
function nodeToValue(node: JsonNode, input: string): unknown {
	switch (node.type) {
		case 'object': {
			const obj: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
			for (const property of node.children ?? []) {
				const keyNode = property.children?.[0];
				const valueNode = property.children?.[1];
				if (!keyNode || !valueNode) continue;
				obj[keyNode.value as string] = nodeToValue(valueNode, input);
			}
			return obj;
		}
		case 'array':
			return (node.children ?? []).map((child) => nodeToValue(child, input));
		case 'number':
			return new LosslessNumber(input.slice(node.offset, node.offset + node.length));
		case 'null':
			return null;
		default:
			return node.value;
	}
}

/** Sort object keys recursively on a null-prototype accumulator. */
function sortObjectKeys(obj: unknown): unknown {
	if (Array.isArray(obj)) {
		return obj.map(sortObjectKeys);
	}
	if (obj instanceof LosslessNumber || obj === null || typeof obj !== 'object') {
		return obj;
	}
	const sorted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(obj).filter((entry): entry is string => typeof entry === 'string').sort()) {
		sorted[key] = sortObjectKeys(Reflect.get(obj, key));
	}
	return sorted;
}

/**
 * Format JSON string with options.
 * With sortKeys the document is parsed losslessly, sorted, and re-serialized.
 * Without sortKeys the engine edits the original text in place, preserving
 * key order, duplicate keys, and the exact original number spelling.
 */
export function formatJSON(
	input: string,
	options: FormatOptions = DEFAULT_OPTIONS
): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}

	try {
		if (options.sortKeys) {
			const { tree, error } = parseStrictTree(input);
			if (!tree) return { success: false, output: input, error };
			const sorted = sortObjectKeys(nodeToValue(tree, input));
			const output = losslessStringify(sorted, undefined, options.indent);
			return { success: true, output: output ?? '' };
		}

		const { error } = parseStrictTree(input);
		if (error) return { success: false, output: input, error };
		const edit = formatJsonText(input, { offset: 0, length: input.length }, { insertSpaces: true, tabSize: options.indent });
		return { success: true, output: applyEdits(input, edit as import('jsonc-parser').Edit[]) };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid JSON';
		return { success: false, output: input, error: msg };
	}
}

/**
 * Minify JSON string: whitespace is removed and every number keeps its exact
 * source digits.
 */
export function minifyJSON(input: string): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}

	try {
		const { tree, error } = parseStrictTree(input);
		if (!tree) return { success: false, output: input, error };
		const output = losslessStringify(nodeToValue(tree, input));
		return { success: true, output: output ?? '' };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid JSON';
		return { success: false, output: input, error: msg };
	}
}

/**
 * Validate JSON and return parse info. Strict JSON only: comments and trailing
 * commas are reported as syntax errors with their offset.
 */
export function validateJSON(input: string): { valid: boolean; error?: string; size?: number } {
	if (!input.trim()) {
		return { valid: true };
	}

	const { tree, error } = parseStrictTree(input);
	if (!tree) return { valid: false, error };
	const size = losslessStringify(nodeToValue(tree, input))?.length;
	return { valid: true, size };
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Save options to storage
 */
export async function saveOptions(options: FormatOptions): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: options });
}

/**
 * Load options from storage
 */
export async function loadOptions(): Promise<FormatOptions> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	return result[STORAGE_KEY] || DEFAULT_OPTIONS;
}
