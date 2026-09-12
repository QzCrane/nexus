// goal: Pomodoro core logic - timer management

import type { PomodoroPhase, PomodoroConfig, PomodoroState } from './types';
import { DEFAULT_CONFIG } from './types';

export const POMODORO_STATE_STORAGE_KEY = 'halo_tool_state_pomodoro-state';
export const POMODORO_CONFIG_STORAGE_KEY = 'halo_tool_state_pomodoro-config';

export type PomodoroCommand =
	| { type: 'toggle' }
	| { type: 'reset'; config: PomodoroConfig }
	| { type: 'skip'; config: PomodoroConfig };

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
		revision: 0,
		phase: 'work',
		endsAt: null,
		remaining: config.workMinutes * 60,
		isRunning: false,
		sessionsCompleted: 0,
		completion: null,
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
	const revision = state.revision === undefined ? 0 : state.revision;
	if (!nonnegativeInteger(revision)) throw new TypeError('Invalid Pomodoro revision');
	const completion = state.completion ?? null;
	if (completion !== null && (typeof completion !== 'object' || typeof completion.id !== 'string' || completion.id.length === 0
		|| !nonnegativeInteger(completion.dueAt) || (completion.status !== 'pending' && completion.status !== 'delivered'))) {
		throw new TypeError('Invalid Pomodoro completion');
	}
	return { ...state, revision, endsAt: state.endsAt ?? null, completion };
}

export function projectedPomodoroRemaining(state: PomodoroState, now: number): number {
	if (!state.isRunning || typeof state.endsAt !== 'number') return state.remaining;
	return Math.max(0, Math.ceil((state.endsAt - now) / 1000));
}

function advancePomodoro(state: PomodoroState, config: PomodoroConfig, revision: number): PomodoroState {
	const phase = getNextPhase(state, config);
	return {
		revision,
		phase,
		remaining: getPhaseDuration(phase, config),
		endsAt: null,
		isRunning: false,
		sessionsCompleted: state.phase === 'work' ? state.sessionsCompleted + 1 : state.sessionsCompleted,
		completion: null,
	};
}

export function applyPomodoroCommand(state: PomodoroState, command: PomodoroCommand, now: number): PomodoroState {
	const revision = state.revision + 1;
	switch (command.type) {
		case 'toggle':
			return state.isRunning
				? { ...state, revision, remaining: projectedPomodoroRemaining(state, now), endsAt: null, isRunning: false }
				: { ...state, revision, endsAt: now + state.remaining * 1000, isRunning: true, completion: null };
		case 'reset': return { ...createInitialState(command.config), revision };
		case 'skip': return advancePomodoro(state, command.config, revision);
	}
}

export function reconcilePomodoroDeadline(state: PomodoroState, config: PomodoroConfig, now: number): PomodoroState {
	if (state.isRunning && typeof state.endsAt !== 'number') {
		return { ...state, revision: state.revision + 1, endsAt: now + state.remaining * 1000 };
	}
	if (!state.isRunning || typeof state.endsAt !== 'number' || now < state.endsAt) return state;
	const dueAt = state.endsAt;
	const next = advancePomodoro(state, config, state.revision + 1);
	return { ...next, completion: { id: `halo-pomodoro-${state.revision}`, dueAt, status: 'pending' } };
}
