// goal: JSON formatting and validation logic

import type { FormatOptions } from './types';
import { DEFAULT_OPTIONS, STORAGE_KEY } from './types';

/**
 * Sort object keys recursively
 */
function sortObjectKeys(obj: unknown): unknown {
	if (Array.isArray(obj)) {
		return obj.map(sortObjectKeys);
	}
	if (obj !== null && typeof obj === 'object') {
		const sorted: Record<string, unknown> = {};
		Object.keys(obj as Record<string, unknown>)
			.sort()
			.forEach(key => {
				sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
			});
		return sorted;
	}
	return obj;
}

export interface FormatResult {
	success: boolean;
	output: string;
	error?: string;
}

/**
 * Format JSON string with options
 */
export function formatJSON(
	input: string,
	options: FormatOptions = DEFAULT_OPTIONS
): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}

	try {
		let parsed = JSON.parse(input);
		if (options.sortKeys) {
			parsed = sortObjectKeys(parsed);
		}
		const output = JSON.stringify(parsed, null, options.indent);
		return { success: true, output };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid JSON';
		return { success: false, output: input, error: msg };
	}
}

/**
 * Minify JSON string
 */
export function minifyJSON(input: string): FormatResult {
	if (!input.trim()) {
		return { success: true, output: '' };
	}

	try {
		const parsed = JSON.parse(input);
		return { success: true, output: JSON.stringify(parsed) };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid JSON';
		return { success: false, output: input, error: msg };
	}
}

/**
 * Validate JSON and return parse info
 */
export function validateJSON(input: string): { valid: boolean; error?: string; size?: number } {
	if (!input.trim()) {
		return { valid: true };
	}

	try {
		const parsed = JSON.parse(input);
		const size = JSON.stringify(parsed).length;
		return { valid: true, size };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid JSON';
		return { valid: false, error: msg };
	}
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
