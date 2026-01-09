// goal: Cron core logic - parse and describe cron expressions

import type { CronParts, CronPreset } from './types';

// Parse cron expression into parts
export function parseCron(cron: string): CronParts | null {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	return {
		minute: parts[0]!,
		hour: parts[1]!,
		dayOfMonth: parts[2]!,
		month: parts[3]!,
		dayOfWeek: parts[4]!,
	};
}

// Describe cron expression in human-readable format
export function describeCron(cron: string): string {
	const parts = parseCron(cron);
	if (!parts) return 'Invalid cron expression';

	const { minute, hour, dayOfMonth, month, dayOfWeek } = parts;
	const descriptions: string[] = [];

	// Time
	if (minute === '*' && hour === '*') {
		descriptions.push('Every minute');
	} else if (minute === '0' && hour === '*') {
		descriptions.push('Every hour');
	} else if (minute !== '*' && hour !== '*') {
		descriptions.push(`At ${formatTime(hour, minute)}`);
	} else if (minute !== '*') {
		descriptions.push(`At minute ${describeField(minute)}`);
	} else if (hour !== '*') {
		descriptions.push(`During hour ${describeField(hour)}`);
	}

	// Day of month
	if (dayOfMonth !== '*') {
		descriptions.push(`on day ${describeField(dayOfMonth)} of month`);
	}

	// Month
	if (month !== '*') {
		descriptions.push(`in ${describeMonth(month)}`);
	}

	// Day of week
	if (dayOfWeek !== '*') {
		descriptions.push(`on ${describeDayOfWeek(dayOfWeek)}`);
	}

	return descriptions.join(' ') || 'Every minute';
}

function formatTime(hour: string, minute: string): string {
	const h = hour.padStart(2, '0');
	const m = minute.padStart(2, '0');
	return `${h}:${m}`;
}

function describeField(field: string): string {
	if (field.includes('/')) {
		const [, step] = field.split('/');
		return `every ${step}`;
	}
	if (field.includes('-')) {
		const [start, end] = field.split('-');
		return `${start} through ${end}`;
	}
	if (field.includes(',')) {
		return field.split(',').join(', ');
	}
	return field;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function describeMonth(field: string): string {
	if (field.includes(',')) {
		return field.split(',').map((m) => MONTHS[parseInt(m)] || m).join(', ');
	}
	return MONTHS[parseInt(field)] || field;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeDayOfWeek(field: string): string {
	if (field.includes(',')) {
		return field.split(',').map((d) => DAYS[parseInt(d)] || d).join(', ');
	}
	return DAYS[parseInt(field)] || field;
}

// Get next N run times
export function getNextRuns(cron: string, count = 5): Date[] {
	const parts = parseCron(cron);
	if (!parts) return [];

	const runs: Date[] = [];
	const now = new Date();
	let candidate = new Date(now);
	candidate.setSeconds(0, 0);

	// Simple simulation - check each minute
	for (let i = 0; i < 60 * 24 * 7 && runs.length < count; i++) {
		candidate = new Date(candidate.getTime() + 60000);
		if (matchesCron(candidate, parts)) {
			runs.push(new Date(candidate));
		}
	}

	return runs;
}

function matchesCron(date: Date, parts: CronParts): boolean {
	return matchField(date.getMinutes(), parts.minute) &&
		matchField(date.getHours(), parts.hour) &&
		matchField(date.getDate(), parts.dayOfMonth) &&
		matchField(date.getMonth() + 1, parts.month) &&
		matchField(date.getDay(), parts.dayOfWeek);
}

function matchField(value: number, field: string): boolean {
	if (field === '*') return true;
	if (field.includes('/')) {
		const [range, step] = field.split('/');
		const stepNum = parseInt(step!);
		if (range === '*') return value % stepNum === 0;
	}
	if (field.includes('-')) {
		const [start, end] = field.split('-').map(Number);
		return value >= start! && value <= end!;
	}
	if (field.includes(',')) {
		return field.split(',').map(Number).includes(value);
	}
	return parseInt(field) === value;
}

// Common presets
export const CRON_PRESETS: CronPreset[] = [
	{ id: 'every-minute', name: 'Every minute', cron: '* * * * *' },
	{ id: 'every-hour', name: 'Every hour', cron: '0 * * * *' },
	{ id: 'every-day-midnight', name: 'Daily at midnight', cron: '0 0 * * *' },
	{ id: 'every-day-noon', name: 'Daily at noon', cron: '0 12 * * *' },
	{ id: 'every-week', name: 'Weekly on Sunday', cron: '0 0 * * 0' },
	{ id: 'every-month', name: 'Monthly on 1st', cron: '0 0 1 * *' },
	{ id: 'weekdays', name: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
];
