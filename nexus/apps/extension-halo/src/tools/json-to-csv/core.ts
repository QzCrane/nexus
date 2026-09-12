// goal: JSON to CSV adapter over Papa Parse (R01)
// rule: header collection and cell typing policy stay with the tool; the
// generic CSV serialization and escaping belong to the engine.

import { serializeCsv, type CsvExportMode } from '../csv-viewer/core';

// Convert JSON array to CSV
export function jsonToCsv(
	json: unknown[],
	delimiter = ',',
	exportMode: CsvExportMode = 'raw',
): string {
	if (!Array.isArray(json) || json.length === 0) return '';

	// Get all keys
	const keys = new Set<string>();
	json.forEach((item) => {
		if (typeof item === 'object' && item !== null) {
			Object.keys(item).forEach((key) => {
				keys.add(key);
			});
		}
	});

	const headers = Array.from(keys);
	const rows = json.map((item) => headers.map((header) => {
		const value = (item as Record<string, unknown>)[header];
		if (value === null || value === undefined) return '';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}));

	return serializeCsv(headers, rows, delimiter, exportMode);
}

// Parse JSON safely
export function parseJson(input: string): { data: unknown[] | null; error: string | null } {
	try {
		const parsed = JSON.parse(input);
		if (!Array.isArray(parsed)) {
			return { data: null, error: 'Input must be a JSON array' };
		}
		return { data: parsed, error: null };
	} catch (_e) {
		return { data: null, error: 'Invalid JSON' };
	}
}
