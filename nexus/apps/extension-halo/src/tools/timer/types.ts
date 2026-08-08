// goal: Timer type definitions

export type TimerMode = 'countdown' | 'stopwatch';

export interface TimerState {
	mode: TimerMode;
	/** Accumulated milliseconds committed at the last pause/reset/start boundary. */
	elapsed: number;
	/** Wall-clock anchor while running. Missing on old persisted states and while paused. */
	startedAt?: number;
	target: number; // milliseconds (for countdown)
	isRunning: boolean;
	laps: number[];
}
