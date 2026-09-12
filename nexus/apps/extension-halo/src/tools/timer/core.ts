// goal: Timer core logic - countdown and stopwatch

import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export const timerMinutesCodec: ToolStateCodec<number> = {
	decode(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Timer minutes must be a non-negative integer.' }; },
	encode(value) { return value; },
};

export const timerSecondsCodec: ToolStateCodec<number> = {
	decode(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 59 ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Timer seconds must be an integer from 0 through 59.' }; },
	encode(value) { return value; },
};

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


import type { TimerMode, TimerState } from './types';

export const TIMER_STORAGE_KEY = 'halo_tool_state_timer';

export type TimerCommand =
	| { type: 'toggle' }
	| { type: 'reset' }
	| { type: 'lap' }
	| { type: 'set-mode'; mode: TimerMode; target: number }
	| { type: 'set-target'; target: number };

export const INITIAL_TIMER_STATE: TimerState = {
	revision: 0, mode: 'stopwatch', elapsed: 0, startedAt: null, target: 300000, isRunning: false, laps: [], completion: null,
};

export function normalizeTimerState(value: unknown): TimerState {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid timer state');
	const state = value as TimerState;
	const integer = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
	if ((state.mode !== 'stopwatch' && state.mode !== 'countdown') || typeof state.isRunning !== 'boolean'
		|| !integer(state.elapsed) || !integer(state.target)
		|| (state.startedAt != null && !integer(state.startedAt))
		|| !Array.isArray(state.laps) || !state.laps.every(integer)) throw new TypeError('Invalid timer fields');
	const revision = state.revision === undefined ? 0 : state.revision;
	if (!integer(revision)) throw new TypeError('Invalid timer revision');
	const completion = state.completion ?? null;
	if (completion !== null && (
		typeof completion !== 'object' || typeof completion.id !== 'string' || completion.id.length === 0
		|| !integer(completion.dueAt) || (completion.status !== 'pending' && completion.status !== 'delivered')
	)) throw new TypeError('Invalid timer completion');
	return { ...state, revision, startedAt: state.startedAt ?? null, completion };
}

export function timerElapsedAt(state: TimerState, now: number): number {
	if (!state.isRunning || typeof state.startedAt !== 'number') return state.elapsed;
	return state.elapsed + Math.max(0, now - state.startedAt);
}

export function timerDeadline(state: TimerState): number | null {
	if (!state.isRunning || state.mode !== 'countdown' || typeof state.startedAt !== 'number') return null;
	return state.startedAt + Math.max(0, state.target - state.elapsed);
}

export function applyTimerCommand(state: TimerState, command: TimerCommand, now: number): TimerState {
	const revision = state.revision + 1;
	switch (command.type) {
		case 'toggle': {
			if (!state.isRunning) return { ...state, revision, startedAt: now, isRunning: true, completion: null };
			const elapsed = timerElapsedAt(state, now);
			return { ...state, revision, elapsed: state.mode === 'countdown' ? Math.min(state.target, elapsed) : elapsed, startedAt: null, isRunning: false };
		}
		case 'reset': return { ...state, revision, elapsed: 0, startedAt: null, isRunning: false, laps: [], completion: null };
		case 'lap': {
			if (state.mode !== 'stopwatch' || !state.isRunning) return state;
			return { ...state, revision, laps: [...state.laps, timerElapsedAt(state, now)] };
		}
		case 'set-mode': return { ...INITIAL_TIMER_STATE, revision, mode: command.mode, target: command.target };
		case 'set-target': {
			if (state.isRunning || state.target === command.target) return state;
			return { ...state, revision, target: command.target, elapsed: 0, completion: null };
		}
	}
}

export function reconcileTimerDeadline(state: TimerState, now: number): TimerState {
	if (state.isRunning && typeof state.startedAt !== 'number') {
		return { ...state, revision: state.revision + 1, startedAt: now };
	}
	const deadline = timerDeadline(state);
	if (deadline === null || now < deadline) return state;
	return {
		...state,
		revision: state.revision + 1,
		elapsed: state.target,
		startedAt: null,
		isRunning: false,
		completion: { id: `halo-timer-${state.revision}`, dueAt: deadline, status: 'pending' },
	};
}
