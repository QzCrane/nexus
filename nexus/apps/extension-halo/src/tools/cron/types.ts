// goal: Cron tool type definitions

export interface CronParts {
	minute: string;
	hour: string;
	dayOfMonth: string;
	month: string;
	dayOfWeek: string;
}

export interface CronPreset {
	id: string;
	name: string;
	cron: string;
}
