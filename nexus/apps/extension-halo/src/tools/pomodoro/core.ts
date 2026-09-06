// goal: Pomodoro core logic - timer management

import type { PomodoroPhase, PomodoroConfig, PomodoroState } from './types';
import { DEFAULT_CONFIG } from './types';

// Format time as MM:SS
export function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Get phase duration in seconds
export function getPhaseDuration(phase: PomodoroPhase, config: PomodoroConfig): number {
	switch (phase) {
		case 'work': return config.workMinutes * 60;
		case 'shortBreak': return config.shortBreakMinutes * 60;
		case 'longBreak': return config.longBreakMinutes * 60;
	}
}

// Get next phase
export function getNextPhase(state: PomodoroState, config: PomodoroConfig): PomodoroPhase {
	if (state.phase === 'work') {
		// After work, check if long break is needed
		const newSessions = state.sessionsCompleted + 1;
		return newSessions % config.sessionsBeforeLongBreak === 0 ? 'longBreak' : 'shortBreak';
	}
	// After any break, go back to work
	return 'work';
}

// Create initial state
export function createInitialState(config: PomodoroConfig = DEFAULT_CONFIG): PomodoroState {
	return {
		phase: 'work',
		endsAt: null,
		remaining: config.workMinutes * 60,
		isRunning: false,
		sessionsCompleted: 0,
	};
}

// Phase labels
export const PHASE_LABELS: Record<PomodoroPhase, string> = {
	work: '🍅 Focus',
	shortBreak: '☕ Short Break',
	longBreak: '🌴 Long Break',
};

// Phase colors
export const PHASE_COLORS: Record<PomodoroPhase, string> = {
	work: '#ef4444',
	shortBreak: '#22c55e',
	longBreak: '#3b82f6',
};


function nonnegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function normalizePomodoroConfig(value: unknown): PomodoroConfig {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Pomodoro configuration');
	const config = value as PomodoroConfig;
	for (const key of ['workMinutes', 'shortBreakMinutes', 'longBreakMinutes', 'sessionsBeforeLongBreak'] as const) {
		if (!nonnegativeInteger(config[key]) || config[key] === 0 || config[key] > Math.floor(Number.MAX_SAFE_INTEGER / 60000)) {
			throw new TypeError('Invalid Pomodoro configuration field');
		}
	}
	return { ...config };
}
export function normalizePomodoroState(value: unknown): PomodoroState {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Pomodoro state');
	const state = value as PomodoroState;
	if (!['work', 'shortBreak', 'longBreak'].includes(state.phase) || typeof state.isRunning !== 'boolean'
		|| !nonnegativeInteger(state.remaining) || !nonnegativeInteger(state.sessionsCompleted)
		|| (state.endsAt != null && !nonnegativeInteger(state.endsAt))) throw new TypeError('Invalid Pomodoro state field');
	return { ...state, endsAt: state.endsAt ?? null };
}
