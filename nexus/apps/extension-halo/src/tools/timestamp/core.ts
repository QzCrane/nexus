// goal: Timestamp conversion core logic with timezone support

/**
 * Format timestamp to string in specific timezone
 */
export function formatWithTZ(date: Date, tz: string): string {
	try {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: 'medium',
			timeZone: tz,
			hour12: false
		}).format(date);
	} catch {
		return 'TZ Error';
	}
}

/**
 * Get relative time string
 */
export function getRelativeTime(date: Date, now: number): string {
	const diff = now - date.getTime();
	const absDiff = Math.abs(diff);
	const isPast = diff > 0;

	const seconds = Math.floor(absDiff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return isPast ? `${days}d ago` : `in ${days}d`;
	if (hours > 0) return isPast ? `${hours}h ago` : `in ${hours}h`;
	if (minutes > 0) return isPast ? `${minutes}m ago` : `in ${minutes}m`;
	return isPast ? `${seconds}s ago` : `in ${seconds}s`;
}

/**
 * Parse input to date (auto-detect)
 */
export function autoParse(input: string): Date | null {
	const trimmed = input.trim();
	if (!trimmed) return new Date();

	if (/^\d{10}$/.test(trimmed)) return new Date(parseInt(trimmed, 10) * 1000);
	if (/^\d{13}$/.test(trimmed)) return new Date(parseInt(trimmed, 10));

	const parsed = new Date(trimmed);
	return isNaN(parsed.getTime()) ? null : parsed;
}

export const TIMEZONES = [
	{ label: 'UTC', value: 'UTC' },
	{ label: 'New York', value: 'America/New_York' },
	{ label: 'London', value: 'Europe/London' },
	{ label: 'Beijing', value: 'Asia/Shanghai' },
	{ label: 'Tokyo', value: 'Asia/Tokyo' },
];
