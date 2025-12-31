// goal: Pomodoro type definitions

export type PomodoroPhase = 'work' | 'shortBreak' | 'longBreak';

export interface PomodoroConfig {
	workMinutes: number;
	shortBreakMinutes: number;
	longBreakMinutes: number;
	sessionsBeforeLongBreak: number;
}

export interface PomodoroState {
	phase: PomodoroPhase;
	remaining: number; // seconds
	isRunning: boolean;
	sessionsCompleted: number;
}

export const DEFAULT_CONFIG: PomodoroConfig = {
	workMinutes: 25,
	shortBreakMinutes: 5,
	longBreakMinutes: 15,
	sessionsBeforeLongBreak: 4,
};
