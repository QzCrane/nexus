// goal: YAML/JSON conversion adapter over the maintained `yaml` engine (R02)
// rule: indentation/scalar/collection parsing and serialization belong to the
// engine. This adapter owns the tool contract: strict duplicate-key handling,
// big-integer fidelity, quoted-string fidelity ('true', '001' stay strings),
// and the JSON round-trip boundary. Duplicate keys and malformed structure fail
// explicitly; values JSON cannot represent are never silently changed.

import { parse as parseYamlDocument, stringify as stringifyYamlDocument } from 'yaml';
import { stringify as losslessStringify, LosslessNumber } from 'lossless-json';
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

/**
 * Convert YAML text to JSON text. Integers beyond the safe range stay exact
 * through the lossless bridge: BigInt leaves become LosslessNumber values so
 * the emitted JSON keeps their full digits.
 */
export function parseYaml(yaml: string): YamlConvertResult {
	try {
		const value = parseYamlDocument(yaml, {
			// Duplicate mapping keys are a document error, not a last-wins merge.
			uniqueKeys: true,
			// Integers beyond Number precision stay exact.
			intAsBigInt: true,
		});
		if (value === undefined) {
			return { success: false, output: '', error: 'The input contains no YAML document.' };
		}
		const bridged = (node: unknown): unknown => {
			if (typeof node === 'bigint') return new LosslessNumber(node.toString());
			if (Array.isArray(node)) return node.map(bridged);
			if (node !== null && typeof node === 'object') {
				return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, bridged(entry)]));
			}
			return node;
		};
		const json = losslessStringify(bridged(value), undefined, 2);
		if (json === undefined) {
			return { success: false, output: '', error: 'The YAML document has no JSON representation.' };
		}
		return { success: true, output: json };
	} catch (e) {
		return { success: false, output: '', error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Convert JSON text to YAML text. JSON strings that YAML would reinterpret
 * (true, 001, null-like text) are quoted by the engine, so values survive a
 * round trip.
 */
export function jsonToYaml(json: string): YamlConvertResult {
	try {
		const obj: unknown = JSON.parse(json);
		const output = stringifyYamlDocument(obj, {
			aliasDuplicateObjects: false,
			lineWidth: 0,
		});
		return {
			success: true,
			output,
			normalizedInput: JSON.stringify(obj, null, 2),
		};
	} catch (e) {
		return { success: false, output: '', error: e instanceof Error ? e.message : String(e) };
	}
}
