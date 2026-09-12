import { describe, expect, test } from 'bun:test';
import {
	INITIAL_TIMER_STATE,
	applyTimerCommand,
	reconcileTimerDeadline,
	timerDeadline,
} from '../src/tools/timer/core';
import {
	applyPomodoroCommand,
	createInitialState,
	reconcilePomodoroDeadline,
} from '../src/tools/pomodoro/core';
import { DEFAULT_CONFIG } from '../src/tools/pomodoro/types';
import { deadlineCoordinatorTestApi } from '../src/kernel/core/deadline-jobs/coordinator';

describe('background deadline state machines', () => {
	test('Timer completion is idempotent and a later revision retires the old deadline', () => {
		const running = applyTimerCommand(
			{ ...INITIAL_TIMER_STATE, mode: 'countdown', target: 1_000 },
			{ type: 'toggle' },
			10_000,
		);
		expect(timerDeadline(running)).toBe(11_000);
		expect(reconcileTimerDeadline(running, 10_999)).toBe(running);
		const completed = reconcileTimerDeadline(running, 11_000);
		expect(completed).toMatchObject({
			isRunning: false,
			elapsed: 1_000,
			completion: { id: `halo-timer-${running.revision}`, dueAt: 11_000, status: 'pending' },
		});
		expect(reconcileTimerDeadline(completed, 20_000)).toBe(completed);
		const reset = applyTimerCommand(completed, { type: 'reset' }, 20_000);
		expect(reset.revision).toBeGreaterThan(completed.revision);
		expect(reset.completion).toBeNull();
	});

	test('Pomodoro advances one phase once after a late wake', () => {
		const running = applyPomodoroCommand(createInitialState(), { type: 'toggle' }, 1_000);
		if (running.endsAt === null || running.endsAt === undefined) throw new Error('running Pomodoro lacks deadline');
		const completed = reconcilePomodoroDeadline(running, running.endsAt + 60_000);
		expect(completed).toMatchObject({
			phase: 'shortBreak',
			isRunning: false,
			sessionsCompleted: 1,
			completion: { id: `halo-pomodoro-${running.revision}`, dueAt: running.endsAt, status: 'pending' },
		});
		expect(reconcilePomodoroDeadline(completed, running.endsAt + 120_000)).toBe(completed);
	});

	test('repairs pre-anchor running states from the recovery clock sample', () => {
		const timer = reconcileTimerDeadline({ ...INITIAL_TIMER_STATE, isRunning: true, startedAt: null }, 500);
		expect(timer.startedAt).toBe(500);
		const pomodoro = reconcilePomodoroDeadline({ ...createInitialState(), isRunning: true, endsAt: null }, DEFAULT_CONFIG, 500);
		expect(pomodoro.endsAt).toBe(500 + DEFAULT_CONFIG.workMinutes * 60_000);
	});

	test('rejects malformed background commands before browser effects', () => {
		expect(deadlineCoordinatorTestApi.isDeadlineCommand({ job: 'timer', command: { type: 'toggle' } })).toBe(true);
		expect(deadlineCoordinatorTestApi.isDeadlineCommand({ job: 'timer', command: { type: 'set-target', target: -1 } })).toBe(false);
		expect(deadlineCoordinatorTestApi.isDeadlineCommand({ job: 'pomodoro', command: { type: 'reset', config: DEFAULT_CONFIG } })).toBe(true);
		expect(deadlineCoordinatorTestApi.isDeadlineCommand({ job: 'pomodoro', command: { type: 'reset', config: { ...DEFAULT_CONFIG, workMinutes: 0 } } })).toBe(false);
	});
});
