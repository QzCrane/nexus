// goal: Timestamp conversion core logic

// goal: Timestamp conversion core logic

// Using Intl.DateTimeFormat for zero dependency.

/**
 * Format timestamp to readable string
 */
export function formatTimestamp(ts: number, unit: 's' | 'ms' | 'us' | 'ns'): string {
	let ms = ts;
	if (unit === 's') ms = ts * 1000;
	if (unit === 'us') ms = ts / 1000;
	if (unit === 'ns') ms = ts / 1000000;

	try {
		const date = new Date(ms);
		if (isNaN(date.getTime())) return 'Invalid Date';

		// ISO String
		const iso = date.toISOString();
		// Local String
		const local = date.toLocaleString();

		return `${iso}\n${local}`;
	} catch {
		return 'Invalid Date';
	}
}

/**
 * Parse date string to timestamp
 * Supports IS0 8601, etc.
 */
export function parseDateToTs(dateStr: string, unit: 's' | 'ms'): number {
	const d = new Date(dateStr);
	if (isNaN(d.getTime())) return NaN;

	const ms = d.getTime();
	return unit === 's' ? Math.floor(ms / 1000) : ms;
}

/**
 * Get current timestamp
 */
export function getCurrentTimestamp(unit: 's' | 'ms'): number {
	const ms = Date.now();
	return unit === 's' ? Math.floor(ms / 1000) : ms;
}
