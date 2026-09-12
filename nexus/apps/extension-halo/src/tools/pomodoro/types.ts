// goal: Pomodoro type definitions

export type PomodoroPhase = 'work' | 'shortBreak' | 'longBreak';

export interface PomodoroConfig {
	workMinutes: number;
	shortBreakMinutes: number;
	longBreakMinutes: number;
	sessionsBeforeLongBreak: number;
}

export interface PomodoroState {
	revision: number;
	phase: PomodoroPhase;
	/** Remaining whole seconds committed while paused or at a phase boundary. */
	remaining: number;
	/** Absolute wall-clock deadline while running; absent on old state and while paused. */
	endsAt?: number | null;
	isRunning: boolean;
	sessionsCompleted: number;
	completion: { id: string; dueAt: number; status: 'pending' | 'delivered' } | null;
}

export const DEFAULT_CONFIG: PomodoroConfig = {
	workMinutes: 25,
	shortBreakMinutes: 5,
	longBreakMinutes: 15,
	sessionsBeforeLongBreak: 4,
};
