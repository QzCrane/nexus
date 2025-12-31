// goal: Timer core logic - countdown and stopwatch

// Format time as HH:MM:SS.ms
export function formatTime(ms: number, showMs = false): string {
	const totalSecs = Math.floor(ms / 1000);
	const hours = Math.floor(totalSecs / 3600);
	const mins = Math.floor((totalSecs % 3600) / 60);
	const secs = totalSecs % 60;
	const milliseconds = Math.floor((ms % 1000) / 10);

	let result = '';
	if (hours > 0) result = `${hours.toString().padStart(2, '0')}:`;
	result += `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	if (showMs) result += `.${milliseconds.toString().padStart(2, '0')}`;

	return result;
}

// Parse time string to milliseconds
export function parseTime(hours: number, mins: number, secs: number): number {
	return (hours * 3600 + mins * 60 + secs) * 1000;
}

// Common presets (in milliseconds)
export const PRESETS = [
	{ label: '1 min', ms: 60000 },
	{ label: '5 min', ms: 300000 },
	{ label: '10 min', ms: 600000 },
	{ label: '15 min', ms: 900000 },
	{ label: '30 min', ms: 1800000 },
	{ label: '1 hour', ms: 3600000 },
];
