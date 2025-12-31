// goal: JSON to CSV core logic

// Convert JSON array to CSV
export function jsonToCsv(json: unknown[], delimiter = ','): string {
	if (!Array.isArray(json) || json.length === 0) return '';

	// Get all keys
	const keys = new Set<string>();
	json.forEach((item) => {
		if (typeof item === 'object' && item !== null) {
			Object.keys(item).forEach((k) => keys.add(k));
		}
	});

	const headers = Array.from(keys);
	const lines: string[] = [];

	// Header row
	lines.push(headers.map((h) => escapeCell(h, delimiter)).join(delimiter));

	// Data rows
	json.forEach((item) => {
		const row = headers.map((h) => {
			const val = (item as Record<string, unknown>)[h];
			if (val === null || val === undefined) return '';
			if (typeof val === 'object') return escapeCell(JSON.stringify(val), delimiter);
			return escapeCell(String(val), delimiter);
		});
		lines.push(row.join(delimiter));
	});

	return lines.join('\n');
}

// Escape CSV cell
function escapeCell(val: string, delimiter: string): string {
	if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
		return `"${val.replace(/"/g, '""')}"`;
	}
	return val;
}

// Parse JSON safely
export function parseJson(input: string): { data: unknown[] | null; error: string | null } {
	try {
		const parsed = JSON.parse(input);
		if (!Array.isArray(parsed)) {
			return { data: null, error: 'Input must be a JSON array' };
		}
		return { data: parsed, error: null };
	} catch (e) {
		return { data: null, error: 'Invalid JSON' };
	}
}
