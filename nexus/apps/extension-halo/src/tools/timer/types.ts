// goal: Timer type definitions

export type TimerMode = 'countdown' | 'stopwatch';

export interface TimerState {
	mode: TimerMode;
	elapsed: number; // milliseconds
	target: number; // milliseconds (for countdown)
	isRunning: boolean;
	laps: number[];
}
