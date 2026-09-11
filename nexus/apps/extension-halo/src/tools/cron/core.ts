// goal: Cron adapter over the maintained `cron-parser` engine (R29)
// rule: the engine owns range/dialect validation and schedule iteration, so
// ranges are verified and monthly schedules deliver real results instead of a
// fixed seven-day window. This adapter owns the tool's parts/description shape.

import { CronExpressionParser } from 'cron-parser';
import type { CronParts, CronPreset } from './types';

// Parse cron expression into parts, validated by the engine
export function parseCron(cron: string): CronParts | null {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
	if (
		minute === undefined
		|| hour === undefined
		|| dayOfMonth === undefined
		|| month === undefined
		|| dayOfWeek === undefined
	) {
		return null;
	}
	// The engine rejects out-of-range fields and unsupported syntax.
	try {
		CronExpressionParser.parse(cron);
	} catch {
		return null;
	}
	return {
		minute,
		hour,
		dayOfMonth,
		month,
		dayOfWeek,
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
		return field.split(',').map((m) => MONTHS[parseInt(m, 10)] || m).join(', ');
	}
	return MONTHS[parseInt(field, 10)] || field;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeDayOfWeek(field: string): string {
	if (field.includes(',')) {
		return field.split(',').map((d) => DAYS[parseInt(d, 10)] || d).join(', ');
	}
	return DAYS[parseInt(field, 10)] || field;
}

// Get next N run times from the engine's real schedule iteration
export function getNextRuns(cron: string, count = 5): Date[] {
	try {
		const expression = CronExpressionParser.parse(cron, { currentDate: new Date() });
		const runs: Date[] = [];
		for (let index = 0; index < count && expression.hasNext(); index++) {
			runs.push(expression.next().toDate());
		}
		return runs;
	} catch {
		return [];
	}
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
