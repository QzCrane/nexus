// goal: Timer type definitions

export type TimerMode = 'countdown' | 'stopwatch';

export interface TimerCompletion {
	id: string;
	dueAt: number;
	status: 'pending' | 'delivered';
}

export interface TimerState {
	/** Monotonic business revision used to retire stale alarms and commands. */
	revision: number;
	mode: TimerMode;
	/** Accumulated milliseconds committed at the last pause/reset/start boundary. */
	elapsed: number;
	/** Wall-clock anchor while running. Missing on old persisted states and while paused. */
	startedAt?: number | null;
	target: number; // milliseconds (for countdown)
	isRunning: boolean;
	laps: number[];
	/** Durable notification outbox for the most recent countdown completion. */
	completion: TimerCompletion | null;
}
